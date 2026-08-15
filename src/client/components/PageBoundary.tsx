import { Component, type ReactNode } from 'react'
import css from './Workbench.module.css'

interface PageBoundaryProps {
  pageId: string
  errorLabel: string
  retryLabel: string
  children: ReactNode
}

interface PageBoundaryState {
  failed: boolean
}

/** Lives inside the DSH slot entry so Fabric owns the retry UI before the host boundary catches. */
export class PageBoundary extends Component<PageBoundaryProps, PageBoundaryState> {
  state: PageBoundaryState = { failed: false }

  static getDerivedStateFromError(): PageBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error(`fabric: page "${this.props.pageId}" crashed`, error)
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className={css.pageError} role="alert">
          <span className={css.pageErrorHead}>
            <span className={css.pageErrorIcon} aria-hidden>!</span>
            <span>{this.props.errorLabel}</span>
          </span>
          <button
            type="button"
            className={css.pageErrorRetry}
            onClick={() => { this.setState({ failed: false }) }}
          >
            {this.props.retryLabel}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
