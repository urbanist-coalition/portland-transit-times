"use client";

import { Component, ReactNode, ErrorInfo } from "react";

import { ErrorOutlineIcon, ReplayIcon } from "@/components/icons";

import styles from "./error.module.css";

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
        <div className={styles.root}>
          <div className={styles.panel}>
            <ErrorOutlineIcon size={64} className={styles.icon} />

            <h1>Oops! Something went wrong.</h1>

            <p className="muted">
              Try refreshing the page, or click the button below.
            </p>

            <button
              type="button"
              className="btn btn-primary"
              onClick={this.handleReset}
            >
              <ReplayIcon size={20} />
              Try again
            </button>

            <p className={styles.contact}>
              If you’re still experiencing an issue, please&nbsp;
              <a
                className="link"
                href="https://form.jotform.com/243556208520150"
                target="_blank"
                rel="noopener noreferrer"
              >
                fill out our issue report form
              </a>
              &nbsp;or e‑mail us at&nbsp;
              <a className="link" href="mailto:contact@urbanistportland.me">
                contact@urbanistportland.me
              </a>
              .
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
