export const whatsappMessage = "Hola Victor, quiero ver cómo funcionaría Citaya en mi negocio.";
export const whatsappHref = `https://wa.me/56996966059?text=${encodeURIComponent(whatsappMessage)}`;

export const services = [
  {
    title: "Diseño de páginas web",
    description:
      "Creamos páginas claras y modernas para que tus clientes entiendan lo que haces y te contacten sin fricción.",
  },
  {
    title: "Agenda online",
    description: "Tus clientes pueden reservar en cualquier momento sin depender de que respondas mensajes.",
  },
  {
    title: "Automatizaciones",
    description: "Confirmaciones, recordatorios y seguimiento automático para reducir trabajo manual.",
  },
  {
    title: "Optimización web",
    description: "Mejoramos tu web para que cargue rápido, se entienda mejor y genere más consultas.",
  },
  {
    title: "Soluciones digitales",
    description: "Combinamos herramientas según tu negocio para ayudarte a vender con más orden.",
  },
] as const;

export const demos = [
  {
    name: "Agenda online para negocios de atención por hora",
    description:
      "Ideal para negocios que necesitan ordenar reservas y evitar pérdidas por coordinación manual.",
    before: "Situación de ejemplo: coordinación manual de reservas por mensajes.",
    after: "Demostración de agenda online con horarios y gestión de solicitudes.",
    result: "Ilustrar un proceso de reserva más ordenado; no es un resultado medido.",
    cta: "Ver demo en vivo",
    href: "https://demo.citaya.online/",
    isExternal: true,
  },
  {
    name: "Web para negocios de servicios",
    description: "Ejemplo de página pensada para explicar servicios de forma clara y facilitar el contacto.",
    before: "Situación de ejemplo: servicios poco visibles en una página comercial.",
    after: "Página demostrativa con información de servicios y acceso a contacto.",
    result: "Mostrar una estructura que facilite encontrar información comercial.",
    cta: "Ver demo",
    href: "/servicios-demo",
    isExternal: false,
  },
  {
    name: "Ejemplo premium personalizable",
    description:
      "Demo con estructura de catálogo y navegación avanzada para negocios que necesitan más organización de contenido.",
    before: "Situación de ejemplo: catálogo difícil de recorrer.",
    after: "Prototipo con catálogo, fichas y navegación organizada.",
    result: "Ilustrar una navegación más clara; no representa métricas reales.",
    cta: "Ver demo",
    href: "/inmo-demo",
    isExternal: false,
  },
] as const;

export const faqs = [
  {
    question: "¿Esto sirve para mi tipo de negocio?",
    answer: "Sí, está pensado para negocios que trabajan por agenda: estéticas, barberías, salud y servicios.",
  },
  {
    question: "¿Necesito saber de tecnología?",
    answer: "No, todo está pensado para ser simple de usar.",
  },
  {
    question: "¿Puedo empezar básico?",
    answer: "Sí, puedes partir simple y luego escalar.",
  },
  {
    question: "¿Incluye agenda online?",
    answer: "Sí, según tu caso.",
  },
  {
    question: "¿Cuánto demora?",
    answer: "Se puede lanzar una versión funcional en poco tiempo.",
  },
  {
    question: "¿Incluye soporte?",
    answer: "Sí, se puede acompañar el proceso.",
  },
] as const;
