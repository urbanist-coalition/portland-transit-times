"use client";

import { Component, ReactNode, ErrorInfo } from "react";
import { Box, Typography, Button, Stack, Link as MuiLink } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ReplayIcon from "@mui/icons-material/Replay";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error", { error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Box
          minHeight="100vh"
          display="flex"
          alignItems="center"
          justifyContent="center"
          sx={{ bgcolor: (theme) => theme.palette.background.default }}
        >
          <Stack
            spacing={3}
            alignItems="center"
            textAlign="center"
            maxWidth={480}
          >
            <ErrorOutlineIcon color="error" sx={{ fontSize: 64 }} />

            <Typography variant="h4" component="h2">
              Oops! Something went wrong.
            </Typography>

            <Typography variant="body1" color="text.secondary">
              Try refreshing the page, or click the button below.
            </Typography>

            <Button
              variant="contained"
              startIcon={<ReplayIcon />}
              onClick={this.handleReset}
            >
              Try again
            </Button>

            <Typography variant="body2" color="text.secondary">
              If you’re still experiencing an issue, please&nbsp;
              <MuiLink
                href="https://form.jotform.com/243556208520150"
                target="_blank"
                rel="noopener noreferrer"
              >
                fill out our issue report form
              </MuiLink>
              &nbsp;or e‑mail us at&nbsp;
              <MuiLink href="mailto:contact@urbanistportland.me">
                contact@urbanistportland.me
              </MuiLink>
              .
            </Typography>
          </Stack>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
