import { Box, Container, Typography } from "@mui/material";
import MaterialLink from "@mui/material/Link";

export default function Footer() {
  return (
    <footer>
      <Container maxWidth="sm" sx={{ pt: 4, pb: 4 }}>
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
          <Box component="img" src="/UCP_logo.png" alt="UCP Logo" width={32} />
        </Box>
      </Container>
    </footer>
  );
}
