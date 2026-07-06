import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { logger } from "../../logger";
import { errorBus } from "./error-bus";
import { ErrorFallback } from "./error-fallback";

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack?: string;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("Unhandled render error", error, info.componentStack);
    errorBus.notifyBoundaryHandled(error.message);
    this.setState({ componentStack: info.componentStack ?? undefined });
  }

  render() {
    const { error, componentStack } = this.state;

    if (error) {
      return <ErrorFallback error={error} componentStack={componentStack} />;
    }

    return this.props.children;
  }
}
