"use client";

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
import { Fragment, useState } from "react";
import { Alert } from "@/types";

interface ServiceAlertsProps {
  serviceAlerts: Alert[];
}

export default function ServiceAlerts({ serviceAlerts }: ServiceAlertsProps) {
  const [expanded, setExpanded] = useState(false);

  const handleChange = () => {
    setExpanded((prevExpanded) => {
      if (serviceAlerts.length === 0) {
        return false;
      }
      return !prevExpanded;
    });
  };

  return (
    <Accordion
      elevation={1}
      sx={{
        // Remove the default MUI Accordion divider line
        "&:before": {
          display: "none",
        },
        // Ensure no clipping of box shadow or rounded edges
        overflow: "hidden",
      }}
      expanded={expanded}
      onChange={handleChange}
    >
      <AccordionSummary
        sx={{
          // Don't rotate the expand icon when the accordion is expanded
          "& .MuiAccordionSummary-expandIconWrapper.Mui-expanded": {
            transform: "none",
          },
        }}
        expandIcon={
          <Chip
            label={serviceAlerts.length}
            color={serviceAlerts.length > 0 ? "warning" : "success"}
            size="small"
            sx={{ ml: 1 }}
          />
        }
      >
        <Typography
          variant="subtitle1"
          sx={{ display: "flex", alignItems: "center" }}
        >
          Service Alerts
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <List disablePadding>
          {serviceAlerts.map((alert, index) => (
            <Fragment key={alert.id}>
              <ListItem disablePadding>
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
