import Arrivals from "@/components/arrivals";
import BackButton from "@/components/back-button";
import Footer from "@/components/footer";
import LinePill from "@/components/line-pill";
import { AddRecentStop, SaveStop } from "@/components/quick-stops";
import ServiceAlerts from "@/components/service-alerts";
import { getStop, predictionsByStopCode } from "@/lib/actions";
import { getServiceAlerts } from "@/lib/actions";

import styles from "./page.module.css";

export default async function StopsStopCodePage({
  params,
}: {
  params: Promise<{ stopCode: string }>;
}) {
  const { stopCode } = await params;
  const [stop, serviceAlerts, predictions] = await Promise.all([
    getStop(stopCode),
    getServiceAlerts(),
    predictionsByStopCode(stopCode),
  ]);

  if (!stop) {
    return (
      <>
        <main className="container container-md">
          <h1>Stop Not Found</h1>
          <p className={styles.notFound}>
            We couldn{"'"}t find a stop with the code {stopCode}. Please try
            again.
          </p>
          <BackButton />
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <main className="container container-md">
        <header className={`surface ${styles.header}`}>
          <BackButton />
          <div className={styles.headerBody}>
            <h1 className={styles.stopName}>{stop.stopName}</h1>
            {stop.routes && stop.routes.length > 0 && (
              <div className={styles.routes}>
                {stop.routes.map(
                  ({ routeId, routeShortName, routeColor, routeTextColor }) => (
                    <LinePill
                      key={routeId}
                      lineName={routeShortName}
                      lineColor={routeColor}
                      lineTextColor={routeTextColor}
                    />
                  )
                )}
              </div>
            )}
          </div>
          <SaveStop stopCode={stopCode} />
        </header>

        <ServiceAlerts serviceAlerts={serviceAlerts} />
        <Arrivals stopCode={stopCode} arrivals={predictions} />
        <AddRecentStop stopCode={stopCode} />
      </main>
      <Footer />
    </>
  );
}
