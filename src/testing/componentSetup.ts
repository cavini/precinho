import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Unmounts whatever a test rendered.
 *
 * Without it every test after the first queries a document still holding
 * the previous one's markup, and the failures that produces look like
 * component bugs rather than like leakage.
 */
afterEach(cleanup)
