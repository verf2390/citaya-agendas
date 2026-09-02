import { ImageResponse } from "next/og";
import { supabaseServer } from "@/lib/supabaseServer";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

async function getDemoBrand(slug: string) {
  const sb = supabaseServer;

  const { data } = await sb
    .from("demo_tenants")
    .select("primary_color, brand_name")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  return {
    color: data?.primary_color ?? "#111827",
    name: data?.brand_name ?? "C",
  };
}

export default async function Icon({
  params,
}: {
  params: { slug: string };
}) {
  const { color, name } = await getDemoBrand(params.slug);

  const letter = name.charAt(0).toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          background: color,
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        {letter}
      </div>
    ),
    {
      ...size,
    }
  );
}
