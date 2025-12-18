import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAIDEN Command Center",
  description: "Neural Link Interface for Instagram Automation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

