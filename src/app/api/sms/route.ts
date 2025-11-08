import { getModel } from "@/lib/model";
import { stopCodeToStopId } from "@/lib/utils";
import { subMinutes, format } from "date-fns";

export async function POST(req: Request) {
  const formData = await req.formData();
  const body = formData.get("Body")?.toString().trim() || "";
  
  if (!body) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Please send a stop code to get arrival times. Example: Send "123" for stop code 123.</Message>
</Response>`,
      {
        headers: {
          "Content-Type": "application/xml",
        },
      }
    );
  }

  const stopCode = body.toUpperCase();
  const stopId = stopCodeToStopId(stopCode);

  try {
    const arrivals = await getModel().getStopTimeInstances(
      stopId,
      subMinutes(new Date(), 10),
      10
    );

    if (arrivals.length === 0) {
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>No arrivals found for stop ${stopCode}. Please check the stop code and try again.</Message>
</Response>`,
        {
          headers: {
            "Content-Type": "application/xml",
          },
        }
      );
    }

    let message = `Arrivals for stop ${stopCode}:\n\n`;
    
    for (const arrival of arrivals) {
      const arrivalTime = new Date(arrival.predictedTime * 1000);
      const timeStr = format(arrivalTime, "h:mm a");
      const minutesUntil = Math.ceil((arrivalTime.getTime() - Date.now()) / (1000 * 60));
      
      let timeDisplay;
      if (minutesUntil <= 0) {
        timeDisplay = "Now";
      } else if (minutesUntil === 1) {
        timeDisplay = "1 min";
      } else {
        timeDisplay = `${minutesUntil} min`;
      }
      
      message += `${arrival.route.routeShortName} ${arrival.trip.tripHeadsign}\n${timeStr} (${timeDisplay})\n\n`;
    }

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message.trim()}</Message>
</Response>`,
      {
        headers: {
          "Content-Type": "application/xml",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching arrivals:", error);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, there was an error getting arrival times. Please try again later.</Message>
</Response>`,
      {
        headers: {
          "Content-Type": "application/xml",
        },
      }
    );
  }
}