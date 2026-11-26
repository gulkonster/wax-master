# First start and the toolchain

Contracts are compiled by WAX CDT, which runs on Linux. WAX Master keeps its own private Linux environment in WSL (Windows Subsystem for Linux) and installs the compiler and the editor engine into it. This is "the toolchain". The Setup page prepares it once.

## How to do it here

The Setup page opens at the first start. You can open it again with Help > Setup.

1. **Windows**: the version and x64 are checked. Nothing to do.
2. **WSL**: if WSL is off, press **Enable WSL**. Windows asks for administrator permission once, downloads WSL (internet needed) and needs a restart. Press **Restart now**, then open WAX Master again; setup goes on where it stopped.
3. **Toolchain**: the install starts by itself once WSL is ready; if it does not, press **Install toolchain**. The app checks every bundled part and installs WAX CDT and the editor engine into a private WSL distribution. No download and no administrator rights; it takes one to two minutes.
4. **Test build**: press **Run test build**. It builds a sample contract and checks that the editor engine answers.
5. When all four rows are green, press **Done**.

![The Setup screen after all four checks have passed: Windows, WSL, the toolchain and a test build.](img:setup)

If the toolchain install fails because virtualization is turned off on your computer, use **Use compatibility mode (WSL 1)** instead of Install toolchain.

[Open the Setup page](app:setup)

## Example

A new computer with WSL already turned on: Setup shows Windows and WSL green and the toolchain install starts by itself. Wait for the log lines to finish, press Run test build, then Done. The status bar now shows the toolchain name (for example WAX CDT 4.1.1wax01) instead of "Toolchain not set up".

## What is needed

- Windows 10 22H2 or Windows 11, x64.
- Internet only if WSL itself must be downloaded by Windows.
- About a minute for the toolchain install.

## Skipping setup

**Skip** keeps editing, chain work and the terminal available. Building and code intelligence stay off until setup is done. You can finish it later from Help > Setup.

## Repair

If builds stop working after a Windows update, open Help > Setup and press **Repair toolchain**. To use another CDT version next to the default one, see [Toolchain versions](doc:toolchain-versions).
