/**
 * Reconstructed, not recorded: the last output lines of a headless shell that can't start its graphics process because
 * the machine can't run its platform. It is rebuilt from the "Container runtimes and cost" research (issue #26), which
 * describes the GPU process dying on qemu's signal 5 six times and the browser then exiting with "GPU process isn't
 * usable". The lines follow Chromium's log shape, but their file names, line numbers and ids are illustrative. A
 * capture recorded under QEMU should replace it when one is made.
 */
export const graphicsFailureOutput: readonly string[] = [
  ...[1, 2, 3, 4, 5, 6].flatMap((attempt) => [
    'qemu: uncaught target signal 5 (Trace/breakpoint trap) - core dumped',
    `[1:23:1114/20150${attempt}.000000:ERROR:gpu_process_host.cc(1)] GPU process exited unexpectedly: exit_code=133`,
  ]),
  "[1:23:1114/201503.000000:FATAL:gpu_data_manager_impl_private.cc(1)] GPU process isn't usable. Goodbye.",
]
