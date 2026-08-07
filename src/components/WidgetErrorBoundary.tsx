/**
 * WidgetErrorBoundary.tsx — Last line of defence around the booking widget.
 *
 * The widget renders full-viewport on the operator's own marketing site and has
 * no style isolation and, until now, no error boundary. Any render-time throw
 * unmounted the entire booking form and left the visitor staring at a blank
 * area with no way to reach the business — which is exactly what the
 * business-hours `.split(":")` crash did.
 *
 * A booking lost to a crash is bad. A booking lost to a crash with no phone
 * number on screen is worse, so the fallback always offers the operator's
 * number when config supplied one.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
    children: ReactNode;
    /** Operator's phone number, used for the `tel:` fallback. May be empty. */
    phoneNumber: string;
    companyName: string;
};

type State = { hasError: boolean };

export default class WidgetErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Host pages vary wildly and there is no error reporting wired up here,
        // so the console is the only channel we have. Keep the prefix greppable.
        console.error("[SYJ Widget] Render error:", error, info.componentStack);
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        const { phoneNumber, companyName } = this.props;
        const telHref = `tel:${phoneNumber.replace(/[^\d+]/g, "")}`;

        return (
            <div
                role="alert"
                style={{
                    padding: "40px 24px",
                    textAlign: "center",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    color: "#334155",
                    // Own the background. The widget has no style isolation and
                    // renders into whatever the operator's page provides — on a
                    // dark site this slate-on-nothing text was near-invisible,
                    // leaving a customer with a blank area again, which is the
                    // exact failure this boundary exists to prevent.
                    background: "#FFFFFF",
                    borderRadius: 12,
                    maxWidth: 560,
                    margin: "24px auto",
                }}
            >
                <p style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
                    Sorry — online booking isn&apos;t loading right now.
                </p>
                {phoneNumber ? (
                    <>
                        <p style={{ margin: "0 0 20px", color: "#64748B" }}>
                            Give us a call and we&apos;ll get you booked in.
                        </p>
                        <a
                            href={telHref}
                            style={{
                                display: "inline-block",
                                padding: "14px 28px",
                                borderRadius: 8,
                                background: "var(--brand, #F97316)",
                                color: "#FFFFFF",
                                fontSize: 18,
                                fontWeight: 600,
                                textDecoration: "none",
                            }}
                        >
                            Call {phoneNumber}
                        </a>
                    </>
                ) : (
                    <p style={{ margin: 0, color: "#64748B" }}>
                        Please refresh the page, or contact {companyName || "us"} directly.
                    </p>
                )}
            </div>
        );
    }
}
