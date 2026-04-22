export const whatsappMessage = "Hola Victor, quiero ver cómo funcionaría Citaya en mi negocio.";
export const whatsappHref = `https://wa.me/56961425029?text=${encodeURIComponent(whatsappMessage)}`;

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
    before: "Agenda manual, mensajes cruzados y pérdida de clientes.",
    after: "Sistema de reservas 24/7 con horarios claros y confirmaciones automáticas.",
    result: "Más reservas y menos tiempo coordinando.",
    cta: "Ver demo en vivo",
    href: "https://demo.citaya.online/",
    isExternal: true,
  },
  {
    name: "Web para negocios de servicios",
    description: "Ejemplo de página pensada para explicar servicios de forma clara y facilitar el contacto.",
    before: "Información poco clara y pocas consultas.",
    after: "Página ordenada con servicios visibles y contacto directo.",
    result: "Más claridad y más consultas útiles.",
    cta: "Ver demo",
    href: "/servicios-demo",
    isExternal: false,
  },
  {
    name: "Ejemplo premium personalizable",
    description:
      "Demo con estructura de catálogo y navegación avanzada para negocios que necesitan más organización de contenido.",
    before: "Contenido extenso sin una estructura clara para vender.",
    after: "Arquitectura más robusta con presentación premium y recorrido guiado.",
    result: "Mejor experiencia y más confianza al momento de contactar.",
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
