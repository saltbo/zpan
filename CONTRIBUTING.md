# Contributing

By participating to this project, you agree to abide our [code of conduct](/CODEOFCONDUCT.md).

## Setup your machine

`zpan` is written in [Go](https://golang.org/).

Prerequisites:

- `make`
- [Go 1.13+](https://golang.org/doc/install)

Clone `zpan` anywhere:

```sh
$ git clone git@github.com:saltbo/zpan.git
```

Install the build and lint dependencies:

```sh
$ make mod
```

A good way of making sure everything is all right is running the test suite:

```sh
$ make test
```

## Test your change

You can create a branch for your changes and try to build from the source as you go:

```sh
$ make build
```

Which runs all the linters and tests.

## Create a commit

Commit messages should be well formatted, and to make that "standardized", we
are using Conventional Commits.

You can follow the documentation on
[their website](https://www.conventionalcommits.org).

## Submit a pull request

Push your branch to your `zpan` fork and open a pull request against the
master branch.

## Financial contributions

We also welcome financial contributions in full transparency on our [open collective](https://opencollective.com/zpan).
Anyone can file an expense. If the expense makes sense for the development of the community, it will be "merged" in the ledger of our open collective by the core contributors and the person who filed the expense will be reimbursed.

## Credits

### Contributors

Thank you to all the people who have already contributed to zpan!
<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>

### Backers

Thank you to all our backers! [[Become a backer](https://opencollective.com/zpan#backer)]

### Sponsors

Thank you to all our sponsors! (please ask your company to also support this open source project by [becoming a sponsor](https://opencollective.com/zpan#sponsor))
