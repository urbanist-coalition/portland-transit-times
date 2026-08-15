import { InstagramIcon } from "@/components/icons";

import styles from "./footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.root}>
      <p className={styles.credit}>
        Made with ❤️ by the{" "}
        <a className="link" href="https://urbanistportland.me">
          Urbanist Coalition of Portland
        </a>
        . Not affiliated with GPMetro.
      </p>
      <a
        className={styles.social}
        href="https://www.instagram.com/urbanistportland.me/"
      >
        <InstagramIcon size={20} /> Follow us on Instagram
      </a>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.logo} src="/UCP_logo.png" alt="UCP Logo" />
    </footer>
  );
}
