import NextLink from "next/link";

import { QuickStops } from "@/components/quick-stops";
import StopSearch from "@/components/stop-search";
import Footer from "@/components/footer";
import ServiceAlerts from "@/components/service-alerts";
import { getServiceAlerts, getStopSummaries } from "@/lib/actions";

import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const serviceAlerts = await getServiceAlerts();
  const stops = await getStopSummaries();

  return (
    <>
      <main className="container container-sm">
        <header className={`surface ${styles.intro}`}>
          <h1 className={styles.title}>Portland Maine Transit</h1>
          <p className={styles.subtitle}>
            Find your stop to keep up to date with <strong>real time</strong>{" "}
            arrivals!
          </p>
        </header>

        <ServiceAlerts serviceAlerts={serviceAlerts} />

        <div className={styles.locationCta}>
          <NextLink href="/by-location" className="btn btn-primary">
            Find Stops By Location
          </NextLink>
        </div>

        <div className={styles.divider}>
          <span>OR</span>
        </div>

        <StopSearch allStops={Object.values(stops)} />
        <QuickStops allStops={stops} />
      </main>
      <Footer />
    </>
  );
}
