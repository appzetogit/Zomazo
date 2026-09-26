// Export utility functions for sellers
export const exportSellersToExcel = (sellers, filename = "sellers") => {
  const headers = [
    "SI",
    "Seller ID",
    "Seller Name",
    "Owner Name",
    "Owner Phone",
    "Zone",
    "Status",
    "Rating"
  ]
  
  const rows = sellers.map((seller, index) => [
    index + 1,
    seller.originalData?.sellerId || seller.originalData?._id || seller._id || seller.id || "N/A",
    seller.name || "N/A",
    seller.ownerName || "N/A",
    seller.ownerPhone || "N/A",
    seller.zone || "N/A",
    seller.isActive ? "Active" : "Inactive",
    seller.rating || 0
  ])
  
  const csvContent = [
    headers.join("\t"),
    ...rows.map(row => row.join("\t"))
  ].join("\n")
  
  const blob = new Blob([csvContent], { type: "application/vnd.ms-excel" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)
  link.setAttribute("href", url)
  link.setAttribute("download", `${filename}_${new Date().toISOString().split("T")[0]}.xls`)
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export const exportSellersToPDF = (sellers, filename = "sellers") => {
  const headers = [
    "SI",
    "Seller ID",
    "Seller Name",
    "Owner Name",
    "Owner Phone",
    "Zone",
    "Status",
    "Rating"
  ]
  
  const rows = sellers.map((seller, index) => [
    index + 1,
    seller.originalData?.sellerId || seller.originalData?._id || seller._id || seller.id || "N/A",
    seller.name || "N/A",
    seller.ownerName || "N/A",
    seller.ownerPhone || "N/A",
    seller.zone || "N/A",
    seller.isActive ? "Active" : "Inactive",
    seller.rating || 0
  ])
  
  const printWindow = window.open("", "_blank")
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${filename}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            padding: 20px; 
            margin: 0;
          }
          h1 { 
            text-align: center; 
            color: #1e293b;
            margin-bottom: 10px;
          }
          p { 
            text-align: center; 
            color: #64748b;
            margin-bottom: 20px;
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-top: 20px; 
            font-size: 12px;
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 8px; 
            text-align: left; 
          }
          th { 
            background-color: #3b82f6; 
            color: white; 
            font-weight: bold; 
          }
          tr:nth-child(even) { 
            background-color: #f9fafb; 
          }
          tr:hover { 
            background-color: #f1f5f9; 
          }
          @media print { 
            body { 
              margin: 0; 
              padding: 10px;
            }
            @page {
              margin: 1cm;
            }
          }
        </style>
      </head>
      <body>
        <h1>Sellers List</h1>
        <p>Generated on: ${new Date().toLocaleString()}</p>
        <table>
          <thead>
            <tr>
              ${headers.map(h => `<th>${h}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                ${row.map(cell => `<td>${cell}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
        <script>
          window.onload = function() {
            window.print();
            setTimeout(() => window.close(), 100);
          }
        </script>
      </body>
    </html>
  `
  printWindow.document.write(htmlContent)
  printWindow.document.close()
}

