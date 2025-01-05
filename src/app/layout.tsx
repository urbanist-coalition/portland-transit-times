import type { Metadata } from "next";
import localFont from "next/font/local";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v13-appRouter";
import "./globals.css";
import { Box, Container, ThemeProvider, Typography } from "@mui/material";
import { theme } from "@/theme";
import { GoogleAnalytics } from "@next/third-parties/google";
import { StaticDataProvider } from "@/components/static-data-provider";
import SpeedDial from "@/components/speed-dial";
import { getAllLines, getAllStops } from "@/lib/actions";

import MaterialLink from "@mui/material/Link";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "UCP Transit Times",
  description: "Transit times for the Greater Portland Metro Area",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const stops = await getAllStops();
  const lines = await getAllLines();

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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <StaticDataProvider stops={stops} lines={lines}>
              {children}
              <footer>
                <Container maxWidth="sm" sx={{ pb: 4 }}>
                  <Box textAlign="center">
                    <Typography
                      variant="caption"
                      textAlign="center"
                      component="div"
                      mb={1}
                    >
                      Made with ❤️ by the{" "}
                      <MaterialLink href="https://urbanistportland.me">
                        Urbanist Coalition of Portland
                      </MaterialLink>
                      . Not affiliated with GPMetro.
                    </Typography>
                    <Box
                      component="img"
                      src="/UCP_logo.png"
                      alt="UCP Logo"
                      width={32}
                    />
                  </Box>
                </Container>
              </footer>
              <SpeedDial />
            </StaticDataProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
      <GoogleAnalytics gaId="G-K5C2F0D9CT" />
    </html>
  );
}
