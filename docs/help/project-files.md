# Project files and settings

A project is a folder with your contract's source and one settings file, `waxmaster.json`. The name of the project is also the name of the contract.

## What is in a project

| Path | What it is |
|---|---|
| `waxmaster.json` | Project settings: main file, contract name, toolchain, folders, build command, deploy settings |
| `src/<name>.cpp` | The main source file |
| `include/<name>.hpp` | The header with the contract class |
| `resource/<name>.contracts.md` | Ricardian text of each action (see [Ricardian contracts](doc:ricardian)) |
| `resource/<name>.clauses.md` | Ricardian clauses for the whole contract |
| `<name>.wasm`, `<name>.abi` | Build results: the code and its description |

## How to do it here

New project:

![New Project: a name, a folder, and a template or one of the example contracts.](img:new-project)

1. File > New Project (or **New** on the Home page).
2. Choose a template or an example. The list has two groups. **Template**: **Empty** (one empty action), **Hello World** (the `hi` action) or **Token** (a standard token). **Examples**: each is a full project with a `README.md` that lists the steps to build, deploy and try it on WAX Testnet; see [All examples](doc:examples).
3. Enter the name: 1 to 12 characters, a-z, 1-5 and dots. It becomes the contract name.
4. Choose the Location. The project is created in a new folder named after it.

Open a project: File > Open Project, or a row on the Home page. A folder without `waxmaster.json` first asks for its main source file (Choose the main file); the other settings start with their defaults. For a folder from EOS Studio they are taken from `.eosproj`, except its build script.

Change the settings: Contract > Project Settings (Ctrl+,). Press **Save** at the bottom; **Discard changes** returns to the saved values.

[New Project](app:new-project) [Project Settings](app:project-settings)

## Project Settings

| Field | Default | Meaning |
|---|---|---|
| Main file | `src/<name>.cpp` | The file passed to the compiler |
| Contract name (`-contract`) | the project name | The contract name in the ABI |
| Version of CDT used in build | the default toolchain | See [Toolchain versions](doc:toolchain-versions) |
| Add directory to include search path (`-I`) | `include` | Folder for headers |
| Add a resource path for inclusion (`-R`) | `resource` | Folder for Ricardian files |
| Write output to (`-o`) | `<name>.wasm` | The WASM file; the ABI gets the same name with `.abi` |
| Custom build command | empty | See [Custom build commands and trust](doc:custom-build-command) |
| Deploy WASM and/or ABI | Both WASM and ABI | What Deploy sends |
| Deploy to (one line per network) | empty | The starred account and permission Deploy uses on that network |

## Example

The default build command of a project named `hello`, as Project Settings shows it:

```
cdt-cpp -abigen -I ./include -R ./resource -contract hello -o ./hello.wasm src/hello.cpp
```

## What is needed

- A name that is a valid contract name (a-z, 1-5, dots; not starting or ending with a dot).
- For the deploy account fields: an account starred on that network. See [Starred accounts](doc:starred-accounts).

> Note: Changing only the deploy settings does not make the next Deploy rebuild the project. Any other change in the project folder does.
