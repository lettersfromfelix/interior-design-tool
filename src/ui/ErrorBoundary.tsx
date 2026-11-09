import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

/** Keeps the rest of the app usable if one part (e.g. the 3D view) crashes. */
export class ErrorBoundary extends Component<Props, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.name} crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="overlay-card" role="alert">
        <h2>The {this.props.name} stopped working</h2>
        <p>{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: undefined })}>Try again</button>
      </div>
    );
  }
}
