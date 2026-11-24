# Custom build commands and trust

By default WAX Master builds with its own fixed command (`cdt-cpp` with the project's settings). A project can set its own build command instead, for example to build several contracts or to run a script first. Such a command runs with your rights inside the toolchain environment, which can read your Windows files. A project folder you downloaded could carry a harmful command, so the app asks you before it runs one.

## How to do it here

1. Contract > Project Settings.
2. Write the command in **Custom build command**. Leave it empty to use the default command shown as the placeholder.
3. Press **Save**.
4. On the next build a dialog of the app shows the project folder and the exact command: **Run this command** or **Cancel**.
5. Your answer is remembered for this folder and this exact command. When the command text changes, you are asked again.

If you press Cancel, the build stops with "Build cancelled: the custom build command was not approved."

[Project Settings](app:project-settings)

## Example

Build the contract and copy the results into a `build` folder:

```
cdt-cpp -abigen -I ./include -R ./resource -contract hello -o ./hello.wasm src/hello.cpp && mkdir -p build && cp hello.wasm hello.abi build/
```

The command runs in the project folder inside the toolchain's Linux environment, so Linux commands such as `mkdir` and `cp` work. Deploy still reads the files named in **Write output to** (`hello.wasm` and `hello.abi` here).

## What is needed

- Trust in the project. Read the command before you approve it.
- A command that writes the WASM and ABI to the output path of Project Settings, or Deploy finds no build.

> Note: The build script of an EOS Studio `.eosproj` file is never imported. When you open such a project, its other settings are taken over and the default command is used.
