import { Command, Prompt } from '@effect/cli';
import { Command as ExecCommand } from '@effect/platform';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import packageJson from '../package.json';

const hyperspan = Command.make('hyperspan');

const projectNamePrompt = Prompt.text({
  message: 'Project name: (e.g., "My app" will write to `./my-app`)',
  validate: (name) => {
    if (name.length === 0) {
      return Effect.fail("Project name can't be empty");
    }

    // If the user provides a string with spaces, slugify it.
    if (name.includes(' ')) {
      return Effect.succeed(
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      );
    }

    return Effect.succeed(name);
  },
});

const createProjectCommand = Command.prompt('create', projectNamePrompt, (name) =>
  ExecCommand.make('bunx', 'degit', 'vlucas/hyperspan/packages/starter-template', name).pipe(
    ExecCommand.string
  )
);

// const dirOption = Options.text('directory of your hyperspan project').pipe(
//   Options.withAlias('dir'),
//   Options.withDefault('./')
// );
//
// const buildSSGCommand = Command.make('build:ssg', { dir: dirOption }, ({ dir }) =>
//   Effect.gen(function* () {
//     const serverFile = `${dir}/app/server.ts`;
//     const fs = yield* FileSystem.FileSystem;
//     if (yield* fs.exists(serverFile)) {
//       return yield* Effect.die(
//         new Error('Error: Could not find app/server.ts - Are you in a Hyperspan project directory?')
//       );
//     }
//
//     const server = yield* Effect.promise(() => import(serverFile));
//     yield* Effect.log({ server });
//   })
// );

const cli = Command.run(
  hyperspan.pipe(
    Command.withSubcommands([
      createProjectCommand,
      // buildSSGCommand
    ])
  ),
  { name: packageJson.name, version: packageJson.version }
);

Effect.suspend(() => cli(process.argv)).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
