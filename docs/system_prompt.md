
## Design System Definition: "Gemini-Modern"

### 1. Core Visual Principles

- **Whitespace:** Prioritize high "breathability." Use generous padding (32\text{px}+ for containers) and large margins between sections.
    
- **Elevation:** Use subtle shadows to indicate depth. Elements should look like they are floating slightly above a flat white surface, not "stuck" to it.
    
- **Corner Radius:** High rounding for a friendly feel. Use `12px` for small components and `24px` for large cards or containers.
    

### 2. The Color Palette (Tokens)

|Token|Hex Value|Role|
|---|---|---|
|`primary-accent`|`#4285F4`|Links, primary buttons, and the word "Mac" style accents.|
|`surface-white`|`#FFFFFF`|Primary background for the entire page.|
|`text-main`|`#1F1F1F`|Headlines and body text (ensures high contrast).|
|`text-muted`|`#474747`|Subheaders and secondary descriptions.|
|`border-light`|`#E3E3E3`|Subtle dividers and button borders.|

### 3. Typography Rules

- **Primary Font:** Use **Inter** or **Roboto** (Google Sans is proprietary; these are the closest open-source matches).
    
- **Headings:** Use `font-weight: 500` or `600`. Keep them large and centered for hero sections.
    
- **Body:** Use `font-weight: 400` with a line-height of `1.6` for readability.
    

### 4. Implementation Instructions for LLM

> "When building UI for this project, always use **Tailwind CSS**.
> 
> - For primary buttons: `bg-[#4285F4] text-white px-6 py-3 rounded-full hover:bg-blue-600 transition-all`.
>     
> - For hero text: `text-5xl font-semibold tracking-tight text-[#1F1F1F]`.
>     
> - For containers: `bg-white border border-[#E3E3E3] rounded-[24px] shadow-sm`.
>     
> - Always center-align hero content unless specified otherwise."
>     


    
