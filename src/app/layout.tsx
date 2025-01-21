import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v13-appRouter";
import "./globals.css";
import { ThemeProvider } from "@mui/material";
import { theme } from "@/theme";
import { GoogleAnalytics } from "@next/third-parties/google";
import SpeedDial from "@/components/speed-dial";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import { QuickStopsProvider } from "@/components/quick-stops";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "UCP Transit Times",
  description: "Transit times for the Greater Portland Metro Area",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();

  const savedStopsRaw = cookieStore.get("savedStops");
  const savedStops =
    savedStopsRaw && (JSON.parse(savedStopsRaw.value) as string[]);

  const recentStopsRaw = cookieStore.get("recentStops");
  const recentStops =
    recentStopsRaw && (JSON.parse(recentStopsRaw.value) as string[]);

  return (
    <html lang="en" suppressHydrationWarning>
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
            <QuickStopsProvider
              savedStops={savedStops}
              recentStops={recentStops}
            >
              <InitColorSchemeScript attribute="class" />
              {children}
              <SpeedDial />
            </QuickStopsProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
      <GoogleAnalytics gaId="G-K5C2F0D9CT" />
    </html>
  );
}
