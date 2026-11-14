import { describe, expect, it } from 'vitest'
import { isInsideContainer } from './inside-container.js'

describe('isInsideContainer', () => {
  it('is true in a Kubernetes pod, whatever files the container has', () => {
    expect(isInsideContainer({ KUBERNETES_SERVICE_HOST: '10.0.0.1' })).toBe(true)
  })
})
