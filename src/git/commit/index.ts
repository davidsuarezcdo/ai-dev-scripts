const CONFIG = {
  token: Deno.env.get("AI_API_TOKEN"),
  model: Deno.env.get("AI_API_MODEL"),
  apiHost: Deno.env.get("AI_API_HOST"),
  apiPort: Deno.env.get("AI_API_PORT"),
  apiPath: Deno.env.get("AI_API_PATH"),
};

const MESSAGES = {
  noChanges: "🚫 No hay cambios en el stage",
  generating: "🔄 Generando nuevo mensaje...",
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
    return JSON.parse(content.replace(/```json|```/g, ""));
  } catch (error) {
    console.error(MESSAGES.networkError, (error as Error).message);
    throw error;
  }
}

function askForConfirmation(commitMessage: string) {
  console.log("✨ Mensaje sugerido:");
  console.log(commitMessage);

  const answer = prompt(`¿Qué deseas hacer?
    - s: Confirmar y crear commit
    - n: Generar nuevo mensaje
    - e: Agregar contexto
    - c: Cancelar operación
  `);

  return answer?.toLowerCase() || "c";
}

async function processCommitMessage() {
  const git_diff_str = await getGitDiff();

  if (git_diff_str.length === 0) {
    console.log(MESSAGES.noChanges);
    return;
  }

  let content = await makeApiRequest(createPrompt(git_diff_str));
  let additionalContext = "";
  let shouldExit = false;

  while (!shouldExit) {
    const answer = askForConfirmation(content.message);

    switch (answer) {
      case "s": {
        console.log(MESSAGES.creating);
        const command = new Deno.Command("git", {
          args: ["commit", "-m", content.message],
        });
        await command.output();
        console.log(MESSAGES.success);
        shouldExit = true;
        break;
      }

      case "n":
        content = await makeApiRequest(await createPrompt(git_diff_str));
        break;

      case "e":
        additionalContext = prompt(MESSAGES.editPrompt) || "";
        content = await makeApiRequest(
          createPrompt(git_diff_str, additionalContext),
        );
        break;

      case "c":
        console.log(MESSAGES.cancelled);
        shouldExit = true;
        break;

      default:
        console.log(MESSAGES.invalidOption);
    }
  }
}

await processCommitMessage();
