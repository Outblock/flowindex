import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowIndex AI",
  description: "Query the Flow blockchain with natural language",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <script defer src="https://analytics.flowindex.io/script.js" data-website-id="d6dd0e53-ae7c-4a2f-a2e0-167747eea01c"></script>
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
