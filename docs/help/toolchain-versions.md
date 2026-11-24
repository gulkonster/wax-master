# Toolchain versions

The toolchain is the contract compiler (CDT) and the editor engine inside the app's private Linux environment. The installer carries one: WAX CDT 4.1.1wax01, the default. You can add other CDT versions next to it and choose one per project, for example to rebuild an old contract with the compiler it was written for.

## How to do it here

Add a version:

1. Download the CDT `.deb` package you want, for example `cdt_4.1.1-1_amd64.deb` from the AntelopeIO releases page.
2. Open Help > Setup. Under **Toolchains**, press **Add from file...** and choose the file.
3. The dialog shows the file, its size and its SHA-256. A green line names a known package; a yellow line says the hash is not on the list of known CDT packages. Install an unknown package only if you trust where it came from.
4. Press **Install**. It is installed offline, next to the default toolchain.

Choose a version for a project:

1. Contract > Project Settings > **Version of CDT used in build**, then **Save**.
2. Or click the toolchain name in the status bar and pick one.

Remove a version: Help > Setup > Toolchains > **Remove** on its row. Projects that used it build with the default toolchain afterwards.

[Open the Setup page](app:setup)

## Example

You want to compare the WAX build of the compiler with the AntelopeIO build. Add `cdt_4.1.1-1_amd64.deb`, choose it in Project Settings and build: the Output shows the other compiler at work. The status bar shows its name while that project is open. Choose the default again to go back.

## What is needed

- The default toolchain installed (Help > Setup).
- A CDT `.deb` package for Linux x86_64.
- The project file stores the version id; on a computer where that version is not installed, the project builds with the default toolchain, and Project Settings says "(not installed; the default is used)".
