import React from "react"
import { Card, CardContent } from "@/components/ui/card"

type Props = { children: React.ReactNode; label?: string }
type State = { error: Error | null }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`, error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-2xl">⚠️</p>
            <p className="font-medium text-sm">
              {this.props.label ? `${this.props.label} failed to load` : "Something went wrong"}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-2 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity"
            >
              Try again
            </button>
          </CardContent>
        </Card>
      )
    }
    return this.props.children
  }
}
