import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

/**
 * PWA manifest, served at /manifest.webmanifest. Name and short name come
 * from the brand config so they cannot drift from the wordmark; the theme
 * colour is Piotrr Cobalt, the background Piotrr Paper.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.name,
    short_name: brand.name,
    description: brand.descriptor,
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4ef",
    theme_color: "#2456ff",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "maskable",
      },
    ],
  };
}
