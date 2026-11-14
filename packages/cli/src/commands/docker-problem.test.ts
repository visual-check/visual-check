import { describe, expect, it } from 'vitest'
import { ContainerError } from '../container/container-error.js'
import { dockerProblemOf } from './docker-problem.js'

const image = 'ghcr.io/visual-check/chromium@sha256:abc'

describe('dockerProblemOf', () => {
  it('names both fixes after the message outside a container', () => {
    expect(dockerProblemOf(new ContainerError('Docker is gone.'), { insideContainer: false, image })).toBe(
      "Docker is gone.\nStart or install Docker, or set platform: 'host' in the config.\n",
    )
  })

  it("names the image as the job container's inside a container", () => {
    expect(dockerProblemOf(new ContainerError('Docker is gone.'), { insideContainer: true, image })).toBe(
      "Docker is gone.\nStart or install Docker, or set platform: 'host' in the config.\n" +
        `Inside a container, run visual-check in a job container on visual-check's image, ${image}, which needs no Docker.\n`,
    )
  })

  it('gives the message alone for Windows containers, which holds its own fix', () => {
    const error = new ContainerError('Switch to Linux containers.', 'linux-containers')

    expect(dockerProblemOf(error, { insideContainer: true, image })).toBe('Switch to Linux containers.\n')
  })
})
