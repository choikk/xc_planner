
# 🌍 Cross Country Planner — Project Overview

This project is part of a larger effort to build a Cross Country Flight Planner for general aviation pilots in the United States.

The planner aims to help student and private pilots visualize potential routes for solo or dual cross-country flights. By selecting a departure airport and defining distance ranges, runway requirements, and preferred airspace classes, pilots can explore suitable destination airports on an interactive map.

To support this functionality, the system relies on a fast, preprocessed JSON dataset that contains:

📍 Airport coordinates (latitude & longitude)
🛬 Runway data (length, surface, condition)
🛡️ Airspace class (B, C, D, E, or default G)
🏙️ City, state, and official airport name
🆔 Unique identifiers for integration with FAA data
This JSON data is generated from the FAA's official CSV datasets and optimized for use in:

Web applications (JavaScript / Apps Script)
Google Sheets functions (via custom Apps Script)
Offline analysis or mobile-friendly tools
Whether you're building a solo XC route that meets §61.109 requirements, checking Class G availability for night flying, or simply exploring possibilities — this planner will streamline the decision-making process.
