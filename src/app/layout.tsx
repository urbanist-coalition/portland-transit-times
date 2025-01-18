import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v13-appRouter";
import "./globals.css";
import { ThemeProvider } from "@mui/material";
import { theme } from "@/theme";
import { GoogleAnalytics } from "@next/third-parties/google";
import SpeedDial from "@/components/speed-dial";

export const metadata: Metadata = {
  title: "UCP Transit Times",
  description: "Transit times for the Greater Portland Metro Area",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          type="image/png"
          href="/favicon-96x96.png"
          sizes="96x96"
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-touch-icon.png"
        />
        <meta name="apple-mobile-web-app-title" content="UCP Transit" />
        <link rel="manifest" href="/site.webmanifest" />
      </head>
      <body>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            {children}
            <SpeedDial />
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
      <GoogleAnalytics gaId="G-K5C2F0D9CT" />
    </html>
  );
}
