import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log('WEBHOOK MERCADOPAGO RECIBIDO:', body);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error('Error webhook Mercado Pago:', error);
    return NextResponse.json({ error: 'error' }, { status: 500 });
  }
}