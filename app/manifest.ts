import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Is My Train Running?",
    short_name: "My Train?",
    description: "Melbourne train disruptions without the confusion.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3efe4",
    theme_color: "#fbf9f3",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
