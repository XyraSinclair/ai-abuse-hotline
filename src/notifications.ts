import { config } from "./config";

const NTFY_URL = `https://ntfy.sh/${config.ntfyTopic}`;

export async function sendNtfy(
  title: string,
  message: string,
  priority: string = "default",
  tags?: string[]
): Promise<void> {
  try {
    const headers: Record<string, string> = { Priority: priority };
    if (tags) {
      headers["Tags"] = tags.join(",");
    }

    const url = new URL(NTFY_URL);
    url.searchParams.set("title", title);

    await fetch(url.toString(), {
      method: "POST",
      body: message,
      headers,
    });

    console.log(`Sent ntfy notification: ${title}`);
  } catch (e) {
    console.error(`Failed to send ntfy notification: ${e}`);
  }
}

export async function notifyNewReport(
  reportId: string,
  origin: string,
  abuseType: string,
  severityBucket: string,
  snippet: string
): Promise<void> {
  const shortSnippet =
    snippet.length > 150 ? snippet.slice(0, 150) + "..." : snippet;

  let priority: string;
  let tags: string[];
  let emoji: string;

  if (severityBucket === "HIGH") {
    priority = "high";
    tags = ["warning", "rotating_light"];
    emoji = "!";
  } else if (severityBucket === "MEDIUM") {
    priority = "default";
    tags = ["speech_balloon"];
    emoji = "-";
  } else {
    priority = "low";
    tags = ["memo"];
    emoji = ".";
  }

  const title = `${emoji} ${severityBucket} - ${abuseType}`;
  const message = `Origin: ${origin}\n\n${shortSnippet}\n\nID: ${reportId.slice(0, 8)}...`;

  await sendNtfy(title, message, priority, tags);
}
