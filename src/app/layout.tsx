import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISLR Data Capture",
  description: "Sign language recognition dataset collection tool",
};

// Runs before React hydrates so the correct theme is applied on first paint
// (otherwise the page would flash light before switching to dark, etc).
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("theme-preference");
    var preference = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    var systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var resolved = preference === "system" ? systemTheme : preference;
    document.documentElement.setAttribute("data-theme", resolved);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}