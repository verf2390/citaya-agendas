export type PropiedadInmo = {
  slug: string;
  titulo: string;
  ubicacion: string;
  precio: string;
  badge: "Premium" | "Nueva" | "Exclusiva" | "Destacada";
  habitaciones: number;
  banos: number;
  metros: number;
  estacionamientos: number;
  tipo: "Penthouse" | "Casa" | "Departamento" | "Dúplex" | "Loft";
  descripcion: string;
  idealPara: "Inversión" | "Familia" | "Inversión y familia";
  imagenPrincipal: string;
  galeria: string[];
};

export const propiedadesInmo: PropiedadInmo[] = [
  {
    slug: "penthouse-vista-panoramica",
    titulo: "Penthouse Vista Panorámica",
    ubicacion: "Las Condes, Santiago",
    precio: "UF 24.900",
    badge: "Exclusiva",
    habitaciones: 4,
    banos: 4,
    metros: 285,
    estacionamientos: 3,
    tipo: "Penthouse",
    idealPara: "Inversión y familia",
    descripcion:
      "Una residencia en altura con terrazas panorámicas, diseño contemporáneo y terminaciones nobles. Seleccionada para quienes buscan una propiedad de alto estándar con potencial real de valorización en el eje oriente de Santiago.",
    imagenPrincipal: "/inmo-demo/properties/pexels-griffinw-6643264.jpg",
    galeria: [
      "/inmo-demo/properties/pexels-griffinw-6643264.jpg",
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg",
      "/inmo-demo/properties/pexels-naimbic-2030037.jpg",
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-32421762.jpg",
    ],
  },
  {
    slug: "residencia-jardin-privado",
    titulo: "Residencia Jardín Privado",
    ubicacion: "Lo Barnechea, Santiago",
    precio: "UF 19.800",
    badge: "Premium",
    habitaciones: 5,
    banos: 5,
    metros: 340,
    estacionamientos: 4,
    tipo: "Casa",
    idealPara: "Familia",
    descripcion:
      "Arquitectura elegante, jardín consolidado y espacios amplios para una vida familiar con privacidad. Una alternativa patrimonial sólida en una zona con demanda sostenida y acceso inmediato a servicios estratégicos.",
    imagenPrincipal: "/inmo-demo/properties/pexels-artbovich-8141956.jpg",
    galeria: [
      "/inmo-demo/properties/pexels-artbovich-8141956.jpg",
      "/inmo-demo/properties/pexels-ansar-muhammad-380085065-27604130.jpg",
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-32421762.jpg",
      "/inmo-demo/properties/pexels-naimbic-2030037.jpg",
    ],
  },
  {
    slug: "departamento-signature-vitacura",
    titulo: "Departamento Signature",
    ubicacion: "Vitacura, Santiago",
    precio: "UF 13.450",
    badge: "Nueva",
    habitaciones: 3,
    banos: 3,
    metros: 168,
    estacionamientos: 2,
    tipo: "Departamento",
    idealPara: "Inversión",
    descripcion:
      "Distribución inteligente, diseño editorial y materialidades de primer nivel. Ideal para compradores que priorizan conectividad, liquidez de activo y una ubicación con proyección en el segmento premium.",
    imagenPrincipal: "/inmo-demo/properties/pexels-naimbic-2030037.jpg",
    galeria: [
      "/inmo-demo/properties/pexels-naimbic-2030037.jpg",
      "/inmo-demo/properties/pexels-griffinw-6643264.jpg",
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg",
      "/inmo-demo/properties/pexels-alef-morais-336305364-34277650.jpg",
    ],
  },
  {
    slug: "casa-contemporanea-chicureo",
    titulo: "Casa Contemporánea en Condominio",
    ubicacion: "Chicureo, Colina",
    precio: "UF 21.700",
    badge: "Destacada",
    habitaciones: 4,
    banos: 4,
    metros: 320,
    estacionamientos: 3,
    tipo: "Casa",
    idealPara: "Familia",
    descripcion:
      "Proyecto residencial de líneas limpias, luminosidad total y áreas exteriores para un estilo de vida activo. Una propiedad seleccionada con criterio para quienes buscan espacio, seguridad y proyección a mediano plazo.",
    imagenPrincipal: "/inmo-demo/properties/pexels-the-ghazi-2152398165-32421762.jpg",
    galeria: [
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-32421762.jpg",
      "/inmo-demo/properties/pexels-ansar-muhammad-380085065-27604130.jpg",
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg",
      "/inmo-demo/properties/pexels-naimbic-2030037.jpg",
    ],
  },
  {
    slug: "loft-autor-providencia",
    titulo: "Loft de Autor",
    ubicacion: "Providencia, Santiago",
    precio: "UF 9.850",
    badge: "Nueva",
    habitaciones: 2,
    banos: 2,
    metros: 112,
    estacionamientos: 1,
    tipo: "Loft",
    idealPara: "Inversión",
    descripcion:
      "Espacio urbano con carácter, altura interior y una estética moderna orientada al estilo de vida profesional. Opción atractiva para arriendo premium y estrategias de renta en comunas de alta rotación.",
    imagenPrincipal: "/inmo-demo/properties/pexels-ansar-muhammad-380085065-27604130.jpg",
    galeria: [
      "/inmo-demo/properties/pexels-ansar-muhammad-380085065-27604130.jpg",
      "/inmo-demo/properties/pexels-naimbic-2030037.jpg",
      "/inmo-demo/properties/pexels-griffinw-6643264.jpg",
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg",
    ],
  },
  {
    slug: "duplex-terraza-mirador",
    titulo: "Dúplex Terraza Mirador",
    ubicacion: "Ñuñoa, Santiago",
    precio: "UF 15.200",
    badge: "Premium",
    habitaciones: 3,
    banos: 3,
    metros: 176,
    estacionamientos: 2,
    tipo: "Dúplex",
    idealPara: "Inversión y familia",
    descripcion:
      "Dúplex de diseño contemporáneo con terraza panorámica y ambientes flexibles. Una combinación de vida urbana y plusvalía potencial para perfiles que priorizan decisiones patrimoniales inteligentes.",
    imagenPrincipal: "/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg",
    galeria: [
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-33314761.jpg",
      "/inmo-demo/properties/pexels-the-ghazi-2152398165-32421762.jpg",
      "/inmo-demo/properties/pexels-naimbic-2030037.jpg",
      "/inmo-demo/properties/pexels-griffinw-6643264.jpg",
    ],
  },
];
