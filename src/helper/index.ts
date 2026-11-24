// Helper process: runs terminals, the compiler and the editor engine.
// It never receives keys or passwords.

process.parentPort?.on('message', () => {
  // Message handling is added with the terminal and toolchain features.
})
