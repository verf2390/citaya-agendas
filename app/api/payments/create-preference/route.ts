import { NextResponse } from 'next/server';
import { getTenantPaymentConfig } from '../../../../services/payments/payment-config';
import { calculatePaymentAmount } from '../../../../services/payments/payment-amount';
import { createMercadoPagoPreference } from '../../../../services/payments/mercadopago';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { appointmentId } = body;

    if (!appointmentId) {
      return NextResponse.json({ error: 'appointmentId requerido' }, { status: 400 });
    }

    const { data: appointment, error: appointmentError } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .single();

    if (appointmentError || !appointment) {
      return NextResponse.json({ error: 'Cita no encontrada' }, { status: 404 });
    }

    const paymentConfig = await getTenantPaymentConfig(appointment.tenant_id);

    if (!paymentConfig.enabled || paymentConfig.mode === 'none') {
      return NextResponse.json({ error: 'Pagos no habilitados' }, { status: 400 });
    }

    if (!paymentConfig.accessToken) {
      return NextResponse.json({ error: 'Falta access token Mercado Pago' }, { status: 400 });
    }

    const { data: service } = await supabase
      .from('services')
      .select('*')
      .eq('id', appointment.service_id)
      .single();

    const servicePrice = service?.price ?? 0;

    const amount = calculatePaymentAmount({
      servicePrice,
      paymentMode: paymentConfig.mode,
      depositType: paymentConfig.depositType,
      depositValue: paymentConfig.depositValue,
    });

    const preference = await createMercadoPagoPreference({
      accessToken: paymentConfig.accessToken,
      title: appointment.service_name || 'Reserva',
      amount,
      externalReference: appointment.id,
      payer: undefined,
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/pago-exitoso`,
      failureUrl: `${process.env.NEXT_PUBLIC_APP_URL}/pago-error`,
      pendingUrl: `${process.env.NEXT_PUBLIC_APP_URL}/pago-pendiente`,
      notificationUrl: 'https://demo.citaya.online/api/webhooks/mercadopago',
    });

    await supabase.from('payments').insert({
      tenant_id: appointment.tenant_id,
      appointment_id: appointment.id,
      mp_preference_id: preference.id,
      external_reference: appointment.id,
      amount,
      status: 'pending',
    });

    return NextResponse.json({
      init_point: preference.init_point,
      preference_id: preference.id,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}