import { ServiceAlert } from "@/types";
import Ajv, { JSONSchemaType } from "ajv";
import Parser from "rss-parser";

const parser: Parser<object, object> = new Parser();

const serviceAlertSchema: JSONSchemaType<ServiceAlert> = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    title: { type: "string", nullable: false },
    link: { type: "string", nullable: true },
    pubDate: { type: "string", nullable: true },
    content: { type: "string", nullable: false },
    contentSnippet: { type: "string", nullable: true },
    guid: { type: "string", nullable: true },
    isoDate: { type: "string", nullable: false, format: "date-time" },
    enclosure: {
      type: "object",
      properties: {
        url: { type: "string", nullable: false },
        length: { type: "number", nullable: true },
        type: { type: "string", nullable: true },
      },
      nullable: true,
      required: ["url"],
    },
  },
  required: ["title", "content", "isoDate"],
};
const ajv = new Ajv();
const validate = ajv.compile(serviceAlertSchema);

export async function getServiceAlerts(): Promise<ServiceAlert[]> {
  const feed = await parser.parseURL(
    "https://gpmetro.org/RSSFeed.aspx?ModID=63&CID=All-0"
  );

  return feed.items.filter((item) => validate(item));
}
