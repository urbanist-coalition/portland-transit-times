import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Fragment } from "react";

import { ServiceAlert } from "@/types";

interface ServiceAlertsProps {
  serviceAlerts: ServiceAlert[];
}

export default function ServiceAlerts({ serviceAlerts }: ServiceAlertsProps) {
  return (
    <Accordion
      sx={{
        borderRadius: "4px",
        boxShadow: 2,
        // Remove the default MUI Accordion divider line
        "&:before": {
          display: "none",
        },
        // Ensure no clipping of box shadow or rounded edges
        overflow: "hidden",
        mb: 2,
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography
          variant="subtitle1"
          sx={{ display: "flex", alignItems: "center" }}
        >
          Service Alerts
          <Chip
            label={serviceAlerts.length}
            color="primary"
            size="small"
            sx={{ ml: 1 }}
          />
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <List disablePadding>
          {serviceAlerts.map((alert, index) => (
            <Fragment key={alert.id}>
              <ListItem>
                <ListItemText
                  primary={alert.headerText}
                  secondary={alert.descriptionText}
                />
              </ListItem>
              {index < serviceAlerts.length - 1 && <Divider component="li" />}
            </Fragment>
          ))}
        </List>
      </AccordionDetails>
    </Accordion>
  );
}
