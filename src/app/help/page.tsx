import BackButton from "@/components/back-button";
import Footer from "@/components/footer";
import { ChevronDownIcon } from "@/components/icons";

import styles from "./page.module.css";

function Question({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  return (
    <details className={`surface ${styles.item}`}>
      <summary className={styles.summary}>
        {question}
        <ChevronDownIcon size={20} className={styles.chevron} />
      </summary>
      <div className={styles.answer}>{children}</div>
    </details>
  );
}

export default function Help() {
  return (
    <>
      <main className="container container-md">
        <header className={`surface ${styles.header}`}>
          <BackButton />
          <h1 className={styles.title}>Help</h1>
        </header>

        <Question question="What is a stop number?">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.figure}
            src="/stop-number.png"
            alt="A bus stop sign with the stop number highlighted"
          />
          <p>
            Every stop has a unique stop number. These numbers are printed on
            the sign at the stop. Sometimes different stops can have similar
            names so the number can be the clearest way to know you are tracking
            the right stop.
          </p>
        </Question>

        <Question question="How can I pay for the bus?">
          <p>
            Download the UMO app on{" "}
            <a
              className="link"
              href="https://play.google.com/store/apps/details?id=com.cubic.ctp.app&hl=en_US"
              target="_blank"
              referrerPolicy="no-referrer"
            >
              Android
            </a>{" "}
            or{" "}
            <a
              className="link"
              href="https://apps.apple.com/us/app/umo-mobility/id1540611257"
              target="_blank"
              referrerPolicy="no-referrer"
            >
              iOS
            </a>{" "}
            to pay for your fare with your phone. You can also pay cash with
            exact change or get a DiriGo Pass smartcard at the{" "}
            <a
              className="link"
              href="https://maps.app.goo.gl/cWfUKvhAEeiVBWJT8"
              target="_blank"
              referrerPolicy="no-referrer"
            >
              Metro Pulse at 21 Elm Street in Portland
            </a>
            ,{" "}
            <a
              className="link"
              href="https://maps.app.goo.gl/pbs8GHo5z3rAnEMN8"
              target="_blank"
              referrerPolicy="no-referrer"
            >
              Saco Transportation Center
            </a>
            , or{" "}
            <a
              className="link"
              href="https://maps.app.goo.gl/FTwSv7kG2nNsNJPN7"
              target="_blank"
              referrerPolicy="no-referrer"
            >
              South Portland City Hall
            </a>{" "}
            and register and add value to your account using a credit or debit
            card. Also add value online and at participating CVS, Walgreens, and
            7-Eleven convenience stores. Tap to pay is coming soon! Once this is
            in place you will be able to pay with your phone or credit card.
          </p>
        </Question>

        <Question question="I am experiencing an issue or I have a suggestion">
          <p>
            We would love to hear from you! If you are experiencing an issue
            please fill out our{" "}
            <a
              className="link"
              href="https://form.jotform.com/243556208520150"
              target="_blank"
              referrerPolicy="no-referrer"
            >
              issue report form
            </a>
            . If you have feedback or a suggestion for the app please fill out
            our{" "}
            <a
              className="link"
              href="https://form.jotform.com/243556164378162"
              target="_blank"
              referrerPolicy="no-referrer"
            >
              feedback form
            </a>
            . We are always looking to improve the app and your feedback is
            invaluable.
          </p>
        </Question>
      </main>
      <Footer />
    </>
  );
}
