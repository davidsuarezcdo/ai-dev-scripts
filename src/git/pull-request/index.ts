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

async function getGitBasePath() {
  const command = new Deno.Command("git", {
    args: ["rev-parse", "--show-toplevel"],
  });
  const { stdout } = await command.output();
  return new TextDecoder().decode(stdout).trim();
}

async function getGitDiff(branch: string) {
  const command = new Deno.Command("git", {
    args: ["diff", `origin/${branch}`],
  });
  const { stdout } = await command.output();
  return new TextDecoder().decode(stdout).trim();
}

async function getGitUniqueCommits(branch: string) {
  const command = new Deno.Command("git", {
    args: ["log", `origin/${branch}..HEAD`, "--pretty=format:%h - %s"],
  });
  const { stdout } = await command.output();
  return new TextDecoder().decode(stdout).trim();
}

function getPullRequestTemplate(basePath: string): string {
  const possibleFiles = ['pull_request_template.md', 'PULL_REQUEST_TEMPLATE.md'];
  
  for (const file of possibleFiles) {
    const path = `${basePath}/.github/${file}`;
    try {
      return Deno.readTextFileSync(path);
    } catch {
      continue;
    }
  }

  return `## Scope
  [chXXXX](https://www.notion.so/comparaonline/...)
  
  ## Purpose
  
  [Here describe the Purpose of the pull request. Include background information if necessary]
  
  ## Solution Approach
  
  [Here describe the Solution Approach of the pull request. How does this change fulfill the purpose?]
  
  ## Learning
  
  [Here describe the research stage. Add links to blog posts, patterns, libraries or addons used to solve this problem.]
  
  ## How to test
  
  [Only if your code can't be tested using an automated test. You should explain why your code can't be tested.]`;
  
}

async function makeApiRequest(promptContent: string) {
  const spinner = ora("🤖 Analizando cambios y generando PR...").start();
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
      throw new Error(`Error en la API: ${response.statusText}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content.trim();
    spinner.succeed("✨ ¡PR generado exitosamente!");
    return JSON.parse(content.replace(/```json|```/g, ""));
  } catch (error) {
    spinner.fail(chalk.red(`❌ Error al generar PR: ${(error as Error).message}`));
    throw error;
  }
}

function createPrompt(prTemplate: string, uniqueCommits: string, gitDiff: string, additionalContext = "") {
  return `
    Eres un arquitecto de software que ayuda a los desarrolladores a crear descripciones y títulos para los PRs.

    ${additionalContext ? `# Contexto adicional proporcionado por el usuario:\n${additionalContext}\n` : ""}

    # Instrucciones
    - El título debe ser con formato de semantic release, por ejemplo:
      - fix: description
      - feat: description
      - perf: description

    - Por favor, proporciona una respuesta en formato JSON con la siguiente estructura:
      {
        "title": "El título del PR en formato semantic release",
        "description": "La descripción completa del PR siguiendo el template proporcionado"
      }

    NOTA IMPORTANTE: Solo debes responder con el JSON, no con ningún otro texto, ni formato, ni comentarios, ni formato de markdown.

    # PR TEMPLATE:
    ${prTemplate}

    # Los últimos commits realizados son los siguientes:
    ${uniqueCommits}
    # El diff entre la rama actual y la rama de destino es el siguiente:
    ${gitDiff}
  `;
}

 function askForConfirmation(content: { title: string, description: string }) {
  console.log('\n📝 Título del PR:\n');
  const [commitType, commitContent] = content.title.split(': ');
  console.log(chalk.bold.blue(`   ${commitType}:`), chalk.green(commitContent), '\n');
  console.log('📄 Descripción del PR:\n');
  console.log(content.description);
  console.log();

  return inquirer.prompt([{
    type: "list",
    name: "action",
    message: "¿Qué deseas hacer?\n",
    choices: [
      { name: "✅ Usar esta descripción", value: "s" },
      { name: "🔄 Generar nueva descripción", value: "n" },
      { name: "📝 Agregar contexto adicional", value: "e" },
      { name: "❌ Cancelar operación", value: "c" },
    ],
  }]).then((answers) => answers.action);
}

async function main() {
  const branch = Deno.args[0] || 'release';
  const gitDiff = await getGitDiff(branch);

  if (gitDiff.length === 0) {
    console.log(chalk.yellow('⚠️  No hay cambios para crear un PR'));
    Deno.exit(0);
  }

  const basePath = await getGitBasePath();
  const prTemplate = getPullRequestTemplate(basePath);
  const uniqueCommits = await getGitUniqueCommits(branch);
  
  let content;
  let additionalContext = "";
  let shouldExit = false;

  try {
    while (!shouldExit) {
      if (!content) {
        content = await makeApiRequest(createPrompt(prTemplate, uniqueCommits, gitDiff, additionalContext));
      }

      const answer = await askForConfirmation(content);
      console.clear();

      switch (answer) {
        case "s":
          console.log(chalk.green("✨ ¡Descripción del PR generada exitosamente!"));
          shouldExit = true;
          break;

        case "n":
          content = await makeApiRequest(createPrompt(prTemplate, uniqueCommits, gitDiff, additionalContext));
          break;

        case "e":
          additionalContext = prompt("📝 Ingresa contexto adicional para la generación del PR:\n") || "";
          content = await makeApiRequest(createPrompt(prTemplate, uniqueCommits, gitDiff, additionalContext));
          break;

        case "c":
          console.log(chalk.yellow("❌ Operación cancelada"));
          shouldExit = true;
          break;
      }
    }
  } catch (error) {
    console.error(chalk.red(`❌ ${(error as Error).message}`));
  } finally {
    Deno.exit(0);
  }
}

await main();
