import type { MetadataRoute } from "next";

// Makes the app installable: "Add to Home Screen" on iPhone, "Install app" on
// Android and desktop Chrome. Opens full-screen with no browser bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SIGMORA Swing Desk",
    short_name: "Swing Desk",
    description: "Live setup scanner and discipline gate for India and US swing trades.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#06060b",
    theme_color: "#06060b",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "India scanner", url: "/scan?m=IN" },
      { name: "US scanner", url: "/scan?m=US" },
      { name: "Journal", url: "/journal" },
    ],
  };
}
