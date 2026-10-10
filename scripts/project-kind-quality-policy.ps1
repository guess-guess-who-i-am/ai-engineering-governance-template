function Get-ProjectKindQualityPolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('web', 'api', 'cli', 'research', 'other')]
        [string]$ProjectType
    )

    $categories = [ordered]@{
        'unit' = 'Enable when the product has isolated logic whose behavior should be checked below a real boundary.'
        'integration' = 'Enable when multiple runtimes, services, datastores, or external systems must work together.'
        'contract' = 'Enable when the product publishes an HTTP, event, schema, package, or CLI interface.'
        'e2e' = 'Enable when the selected project shape has a real user or pipeline journey to verify.'
        'accessibility' = 'Enable when the product has a user interface that people must perceive and operate.'
        'performance' = 'Enable when response time, throughput, page weight, or resource use can change product success.'
        'dependency-security' = 'Enable when the product adopts a package or dependency manifest.'
        'container-security' = 'Enable when the product builds or publishes a container image.'
        'compatibility' = 'Enable when the product promises supported browsers, operating systems, runtimes, or reproducible environments.'
        'deployment' = 'Enable when the product is deployed, distributed, or published outside the repository.'
        'data-quality' = 'Enable when datasets or analytical transformations affect the product result.'
    }
    $defaults = @{
        web = @('e2e', 'accessibility', 'performance', 'dependency-security', 'compatibility', 'deployment')
        api = @('contract', 'e2e', 'performance', 'dependency-security', 'compatibility', 'deployment')
        cli = @('contract', 'e2e', 'dependency-security', 'compatibility', 'deployment')
        research = @('e2e', 'dependency-security', 'compatibility', 'data-quality')
        other = @()
    }
    $selected = @($defaults[$ProjectType])

    foreach ($entry in $categories.GetEnumerator()) {
        $required = $entry.Key -in $selected
        [pscustomobject]@{
            Category = $entry.Key
            RequiredBeforeRelease = $required
            Rationale = if ($required) {
                "The '$($entry.Key)' category is a default release concern for a '$ProjectType' project. Replace this plan with an executable project-specific gate."
            }
            else {
                "Not enabled from project type '$ProjectType' alone. $($entry.Value)"
            }
        }
    }
}
