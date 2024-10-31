import chalk from "npm:chalk";
import ora from "npm:ora";
import inquirer from "npm:inquirer";

const CONFIG = {
  token: Deno.env.get("AI_API_TOKEN"),
  model: Deno.env.get("AI_API_MODEL"),
  apiHost: Deno.env.get("AI_API_HOST"),
  apiPort: Deno.env.get("AI_API_PORT"),
  apiPath: Deno.env.get("AI_API_PATH"),
};

const MESSAGES = {
  noChanges: "🚫 No hay cambios en el stage",
  generating: "Generando nuevo mensaje...",
  success: "✨ ¡Commit realizado con éxito!\n",
  creating: "✅ Creando commit...",
  cancelled: "❌ Operación cancelada\n",
  invalidOption: "⚠️  Opción no válida. Por favor, intenta nuevamente.\n",
  error: "❌ Error: ",
  editPrompt: "📝 Ingresa contexto adicional para la generación del mensaje:\n",
  apiError: "🔴 Error en la API: ",
  networkError: "🌐 Error de red: ",
};

async function getGitDiff() {
  const command = new Deno.Command("git", {
    args: ["diff", "--staged"],
  });

  const { stdout } = await command.output();
  const text = new TextDecoder().decode(stdout);

  return text.trim();
}

function createPrompt(diffContent: string, additionalContext = "") {
  return `
    Eres un arquitecto de software que ayuda a los desarrolladores a crear mensajes de commit.

    ${
    additionalContext
      ? `# Contexto adicional proporcionado por el usuario:\n${additionalContext}\n`
      : ""
  }

    # Instrucciones
    - El mensaje debe ser con formato de semantic release, por ejemplo:
      - fix: description
      - feat: description
      - perf: description
    - El mensaje debe ser en inglés.
    - El mensaje no debe superar los 72 caracteres.

    - Por favor, proporciona una respuesta en formato JSON con la siguiente estructura:
      {
        "message": "El mensaje del commit en formato semantic release"
      }

    NOTA IMPORTANTE: Solo debes responder con el JSON, no con ningún otro texto, ni formato, ni comentarios, ni formato de markdown.

    # El diff es el siguiente:
    ${diffContent}
  `;
}

async function makeApiRequest(promptContent: string) {
  const spinner = ora(MESSAGES.generating).start();
  try {
    const response = await fetch(
      `https://${CONFIG.apiHost}:${CONFIG.apiPort}${CONFIG.apiPath}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CONFIG.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CONFIG.model,
          messages: [{ role: "user", content: promptContent }],
        }),
      },
    );

    if (!response.ok) {
      throw new Error(MESSAGES.apiError + response.statusText);
    }

    const result = await response.json();
    const content = result.choices[0].message.content.trim();
    spinner.succeed();
    return JSON.parse(content.replace(/```json|```/g, ""));
  } catch (error) {
    spinner.fail(chalk.red(MESSAGES.networkError + (error as Error).message));
    throw error;
  }
}

function askForConfirmation(commitMessage: string) {
  console.log(chalk.cyan("✨ Mensaje sugerido:\n"));

  const [commitType, commitContent] = commitMessage.split(": ");
  console.log(
    chalk.bold.blue(commitType) + ":",
    chalk.italic.green(commitContent),
  );
  console.log();

  return inquirer.prompt([{
    type: "list",
    name: "action",
    message: "¿Qué deseas hacer?\n",
    choices: [
      { name: "✅ Crear commit", value: "s" },
      { name: "🔄 Generar nuevo mensaje", value: "n" },
      { name: "📝 Agregar contexto adicional", value: "e" },
      { name: "❌ Cancelar operación", value: "c" },
    ],
  }]).then((answers) => answers.action);
}

async function processCommitMessage() {
  const git_diff_str = await getGitDiff();

  if (git_diff_str.length === 0) {
    console.log(chalk.yellow(MESSAGES.noChanges));
    return;
  }

  let content = await makeApiRequest(createPrompt(git_diff_str));
  console.clear();
  let additionalContext = "";
  let shouldExit = false;

  while (!shouldExit) {
    const answer = await askForConfirmation(content.message);

    switch (answer) {
      case "s": {
        const spinner = ora(MESSAGES.creating).start();
        const command = new Deno.Command("git", {
          args: ["commit", "-m", content.message],
        });
        await command.output();
        spinner.succeed(chalk.green(MESSAGES.success));
        shouldExit = true;
        break;
      }

      case "n":
        console.clear();
        content = await makeApiRequest(await createPrompt(git_diff_str));
        break;

      case "e":
        additionalContext = prompt(MESSAGES.editPrompt) || "";
        content = await makeApiRequest(
          createPrompt(git_diff_str, additionalContext),
        );
        break;

      case "c":
        shouldExit = true;
        break;

      default:
        console.log(MESSAGES.invalidOption);
    }
  }

  Deno.exit(0);
}

await processCommitMessage();
