import { ChevronDownIcon } from "@/components/icons";
import { Alert } from "@/types";

import styles from "./service-alerts.module.css";

interface ServiceAlertsProps {
  serviceAlerts: Alert[];
}

/**
 * Built on <details> rather than a JS-driven accordion, so this stays a server
 * component and ships no client JavaScript at all.
 */
export default function ServiceAlerts({ serviceAlerts }: ServiceAlertsProps) {
  const count = serviceAlerts.length;

  // With nothing to expand, a disclosure control would just be a dead end
  if (count === 0) {
    return (
      <div className={`surface ${styles.root} ${styles.empty}`}>
        <span className={styles.title}>Service Alerts</span>
        <span className={styles.badge} data-tone="ok">
          0
        </span>
      </div>
    );
  }

  return (
    <details className={`surface ${styles.root}`}>
      <summary className={styles.summary}>
        <span className={styles.title}>Service Alerts</span>
        <span className={styles.badge} data-tone="warn">
          {count}
        </span>
        <ChevronDownIcon size={20} className={styles.chevron} />
      </summary>
      <ul className={styles.list}>
        {serviceAlerts.map((alert) => (
          <li key={alert.id} className={styles.alert}>
            <p className={styles.alertHeader}>{alert.headerText}</p>
            {alert.descriptionText && (
              <p className={styles.alertBody}>{alert.descriptionText}</p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
