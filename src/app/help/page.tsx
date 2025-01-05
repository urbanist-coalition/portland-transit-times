import BackButton from "@/components/back-button";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Container,
  Link,
  Typography,
} from "@mui/material";

export default function Help() {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        <BackButton /> Help
      </Typography>
      <Accordion>
        <AccordionSummary>What is a stop number?</AccordionSummary>
        <AccordionDetails>
          <Box textAlign="center" p={2}>
            <Box
              component="img"
              src="/stop-number.png"
              alt="Stop Number"
              width={300}
              maxWidth="100%"
              display="inline-block"
            />
          </Box>
          <Typography>
            Every stop has a unique stop number. These numbers are printed on
            the sign at the stop. Sometimes different stops can have similar
            names so the number can be the clearest way to know you are tracking
            the right stop.
          </Typography>
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary>How can I pay for the bus?</AccordionSummary>
        <AccordionDetails>
          Download the UMO app on{" "}
          <Link
            href="https://play.google.com/store/apps/details?id=com.cubic.ctp.app&hl=en_US"
            target="_blank"
            referrerPolicy="no-referrer"
          >
            Android
          </Link>{" "}
          or{" "}
          <Link
            href="https://apps.apple.com/us/app/umo-mobility/id1540611257"
            target="_blank"
            referrerPolicy="no-referrer"
          >
            iOS
          </Link>{" "}
          to pay for your fare with your phone. You can also pay cash with exact
          change or get a DiriGo Pass smartcard at the{" "}
          <Link
            href="https://maps.app.goo.gl/cWfUKvhAEeiVBWJT8"
            target="_blank"
            referrerPolicy="no-referrer"
          >
            Metro Pulse at 21 Elm Street in Portland
          </Link>
          ,{" "}
          <Link
            href="https://maps.app.goo.gl/pbs8GHo5z3rAnEMN8"
            target="_blank"
            referrerPolicy="no-referrer"
          >
            Saco Transportation Center
          </Link>
          , or{" "}
          <Link
            href="https://maps.app.goo.gl/FTwSv7kG2nNsNJPN7"
            target="_blank"
            referrerPolicy="no-referrer"
          >
            South Portland City Hall
          </Link>{" "}
          and register and add value to your account using a credit or debit
          card. Also add value online and at participating CVS, Walgreens, and
          7-Eleven convenience stores. Tap to pay is coming soon! Once this is
          in place you will be able to pay with your phone or credit card.
        </AccordionDetails>
      </Accordion>
      <Accordion>
        <AccordionSummary>
          I am experiencing an issue or I have a suggestion
        </AccordionSummary>
        <AccordionDetails>
          We would love to hear from you! If you are experiencing an issue
          please fill out our{" "}
          <Link
            href="https://form.jotform.com/243556208520150"
            target="_blank"
            referrerPolicy="no-referrer"
          >
            issue report form
          </Link>
          . If you have feedback or a suggestion for the app please fill out our{" "}
          <Link
            href="https://form.jotform.com/243556164378162"
            target="_blank"
            referrerPolicy="no-referrer"
          >
            feedback form
          </Link>
          . We are always looking to improve the app and your feedback is
          invaluable.
        </AccordionDetails>
      </Accordion>
    </Container>
  );
}
