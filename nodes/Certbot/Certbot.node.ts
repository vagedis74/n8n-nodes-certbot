import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { exec } from 'child_process';
import { writeFile, unlink, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

function execAsync(command: string): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error: Error | null, stdout: string, stderr: string) => {
			if (error) {
				reject(Object.assign(error, { stdout, stderr }));
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

// ---------------------------------------------------------------------------
//  Operation handlers (standalone functions receiving IExecuteFunctions)
// ---------------------------------------------------------------------------

async function executeObtain(
	ctx: IExecuteFunctions,
	itemIndex: number,
	prefix: string,
): Promise<IDataObject> {
	const credentials = await ctx.getCredentials('cloudflareDnsApi', itemIndex);

	const domains = (ctx.getNodeParameter('domains', itemIndex) as string)
		.split(',')
		.map((d) => d.trim())
		.filter(Boolean);
	const email = ctx.getNodeParameter('email', itemIndex) as string;
	const certName = ctx.getNodeParameter('certName', itemIndex) as string;
	const keyType = ctx.getNodeParameter('keyType', itemIndex) as string;
	const server = ctx.getNodeParameter('server', itemIndex) as string;
	const forceRenewal = ctx.getNodeParameter('forceRenewal', itemIndex) as boolean;
	const propagationSeconds = ctx.getNodeParameter('propagationSeconds', itemIndex) as number;
	const additionalArguments = ctx.getNodeParameter('additionalArguments', itemIndex) as string;

	if (domains.length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'At least one domain is required');
	}

	// Write temporary Cloudflare credentials file
	const tmpFile = join(tmpdir(), `cloudflare-${randomUUID()}.ini`);

	try {
		let iniContent: string;
		if (credentials.authMethod === 'apiToken') {
			iniContent = `dns_cloudflare_api_token = ${credentials.apiToken as string}\n`;
		} else {
			iniContent = [
				`dns_cloudflare_email = ${credentials.email as string}`,
				`dns_cloudflare_api_key = ${credentials.globalApiKey as string}`,
				'',
			].join('\n');
		}

		await writeFile(tmpFile, iniContent, { mode: 0o600 });
		await chmod(tmpFile, 0o600);

		const domainArgs = domains.map((d) => `-d ${shellEscape(d)}`).join(' ');

		const parts = [
			`${prefix}certbot certonly`,
			'--dns-cloudflare',
			`--dns-cloudflare-credentials ${shellEscape(tmpFile)}`,
			`--dns-cloudflare-propagation-seconds ${propagationSeconds}`,
			domainArgs,
			`--email ${shellEscape(email)}`,
			'--agree-tos',
			'--non-interactive',
			`--key-type ${shellEscape(keyType)}`,
		];

		if (certName) {
			parts.push(`--cert-name ${shellEscape(certName)}`);
		}

		if (server === 'staging') {
			parts.push('--staging');
		}

		// Always allow expanding existing certificates with new domains
		parts.push('--expand');

		if (forceRenewal) {
			parts.push('--force-renewal');
		}

		if (additionalArguments.trim()) {
			parts.push(additionalArguments.trim());
		}

		const command = parts.join(' ');
		const { stdout, stderr } = await execAsync(command);
		const output = (stdout + '\n' + stderr).trim();

		return parseObtainOutput(output);
	} finally {
		try {
			await unlink(tmpFile);
		} catch {
			// Ignore cleanup errors
		}
	}
}

async function executeRenew(
	ctx: IExecuteFunctions,
	itemIndex: number,
	prefix: string,
): Promise<IDataObject> {
	const certName = ctx.getNodeParameter('certNameRenew', itemIndex) as string;
	const forceRenewal = ctx.getNodeParameter('forceRenewal', itemIndex) as boolean;
	const dryRun = ctx.getNodeParameter('dryRun', itemIndex) as boolean;

	const parts = [
		`${prefix}certbot renew`,
		`--cert-name ${shellEscape(certName)}`,
		'--non-interactive',
	];

	if (forceRenewal) {
		parts.push('--force-renewal');
	}

	if (dryRun) {
		parts.push('--dry-run');
	}

	const command = parts.join(' ');
	const { stdout, stderr } = await execAsync(command);
	const output = (stdout + '\n' + stderr).trim();

	return {
		success: true,
		certName,
		rawOutput: output,
	};
}

async function executeRevoke(
	ctx: IExecuteFunctions,
	itemIndex: number,
	prefix: string,
): Promise<IDataObject> {
	const revokeBy = ctx.getNodeParameter('revokeBy', itemIndex) as string;
	const reason = ctx.getNodeParameter('revokeReason', itemIndex) as string;
	const deleteAfterRevoke = ctx.getNodeParameter('deleteAfterRevoke', itemIndex) as boolean;

	let certIdentifier: string;
	let certName: string;

	if (revokeBy === 'name') {
		certName = ctx.getNodeParameter('certNameRevoke', itemIndex) as string;
		certIdentifier = `--cert-name ${shellEscape(certName)}`;
	} else {
		const certPath = ctx.getNodeParameter('certPath', itemIndex) as string;
		certName = certPath;
		certIdentifier = `--cert-path ${shellEscape(certPath)}`;
	}

	const parts = [
		`${prefix}certbot revoke`,
		certIdentifier,
		`--reason ${shellEscape(reason)}`,
		'--non-interactive',
	];

	if (deleteAfterRevoke) {
		parts.push('--delete-after-revoke');
	} else {
		parts.push('--no-delete-after-revoke');
	}

	const command = parts.join(' ');
	const { stdout, stderr } = await execAsync(command);
	const output = (stdout + '\n' + stderr).trim();

	return {
		success: true,
		certName,
		rawOutput: output,
	};
}

async function executeDelete(
	ctx: IExecuteFunctions,
	itemIndex: number,
	prefix: string,
): Promise<IDataObject> {
	const certName = ctx.getNodeParameter('certNameDelete', itemIndex) as string;

	const command = `${prefix}certbot delete --cert-name ${shellEscape(certName)} --non-interactive`;
	const { stdout, stderr } = await execAsync(command);
	const output = (stdout + '\n' + stderr).trim();

	return {
		success: true,
		certName,
		rawOutput: output,
	};
}

async function executeList(
	prefix: string,
): Promise<Array<IDataObject>> {
	const command = `${prefix}certbot certificates --non-interactive`;
	const { stdout, stderr } = await execAsync(command);
	const output = (stdout + '\n' + stderr).trim();

	return parseCertificatesOutput(output);
}

// ---------------------------------------------------------------------------
//  Output parsers
// ---------------------------------------------------------------------------

function parseObtainOutput(output: string): IDataObject {
	const result: IDataObject = {
		success: true,
		certificatePath: '',
		privateKeyPath: '',
		expiryDate: '',
		rawOutput: output,
	};

	const certPathMatch = output.match(/Certificate is saved at:\s*(\S+)/i)
		|| output.match(/cert\.pem\s*(?:is|at|:)\s*(\S+)/i);
	if (certPathMatch) {
		result.certificatePath = certPathMatch[1];
	}

	const keyPathMatch = output.match(/Key is saved at:\s*(\S+)/i)
		|| output.match(/privkey\.pem\s*(?:is|at|:)\s*(\S+)/i);
	if (keyPathMatch) {
		result.privateKeyPath = keyPathMatch[1];
	}

	const expiryMatch = output.match(/expires?\s+on\s+(\d{4}-\d{2}-\d{2})/i)
		|| output.match(/valid until\s+(\d{4}-\d{2}-\d{2})/i)
		|| output.match(/(\d{4}-\d{2}-\d{2})/);
	if (expiryMatch) {
		result.expiryDate = expiryMatch[1];
	}

	return result;
}

function parseCertificatesOutput(output: string): Array<IDataObject> {
	const certificates: Array<IDataObject> = [];

	const blocks = output.split(/(?=Certificate Name:)/);

	for (const block of blocks) {
		const nameMatch = block.match(/Certificate Name:\s*(\S+)/);
		if (!nameMatch) continue;

		const cert: IDataObject = {
			certificateName: nameMatch[1],
			domains: [] as string[],
			expiryDate: '',
			validity: '',
			certificatePath: '',
			privateKeyPath: '',
		};

		const domainsMatch = block.match(/Domains:\s*(.+)/)
			|| block.match(/Identifiers:\s*(.+)/);
		if (domainsMatch) {
			cert.domains = domainsMatch[1].trim().split(/\s+/);
		}

		const expiryMatch = block.match(/Expiry Date:\s*(.+?)(?:\s*\(|$)/);
		if (expiryMatch) {
			cert.expiryDate = expiryMatch[1].trim();
		}

		const validityMatch = block.match(/\(VALID:\s*(.+?)\)/i)
			|| block.match(/\(INVALID:\s*(.+?)\)/i);
		if (validityMatch) {
			cert.validity = validityMatch[1].trim();
		}

		const certPathMatch = block.match(/Certificate Path:\s*(\S+)/);
		if (certPathMatch) {
			cert.certificatePath = certPathMatch[1];
		}

		const keyPathMatch = block.match(/Private Key Path:\s*(\S+)/);
		if (keyPathMatch) {
			cert.privateKeyPath = keyPathMatch[1];
		}

		certificates.push(cert);
	}

	return certificates;
}

// ---------------------------------------------------------------------------
//  Node class
// ---------------------------------------------------------------------------

export class Certbot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Certbot',
		name: 'certbot',
		icon: 'file:certbot.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Manage Let\'s Encrypt SSL certificates via Certbot with Cloudflare DNS-01 validation',
		defaults: {
			name: 'Certbot',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'cloudflareDnsApi',
				required: true,
				displayOptions: {
					show: {
						operation: ['obtain'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Delete Certificate',
						value: 'delete',
						description: 'Delete a certificate from the local Certbot store',
						action: 'Delete a certificate',
					},
					{
						name: 'List Certificates',
						value: 'list',
						description: 'List all certificates managed by Certbot',
						action: 'List all certificates',
					},
					{
						name: 'Obtain Certificate',
						value: 'obtain',
						description: 'Obtain a new certificate using Cloudflare DNS-01 validation',
						action: 'Obtain a certificate',
					},
					{
						name: 'Renew Certificate',
						value: 'renew',
						description: 'Renew a specific certificate',
						action: 'Renew a certificate',
					},
					{
						name: 'Revoke Certificate',
						value: 'revoke',
						description: 'Revoke a certificate',
						action: 'Revoke a certificate',
					},
				],
				default: 'obtain',
			},

			// Use Sudo (all operations)
			{
				displayName: 'Use Sudo',
				name: 'useSudo',
				type: 'boolean',
				default: false,
				description: 'Whether to prepend "sudo" to the certbot command',
			},

			// Obtain parameters
			{
				displayName: 'Domains',
				name: 'domains',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['obtain'] } },
				placeholder: 'example.com, *.example.com',
				description: 'Comma-separated list of domain names to include in the certificate',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['obtain'] } },
				placeholder: 'admin@example.com',
				description: 'Email address for Let\'s Encrypt registration and renewal notices',
			},
			{
				displayName: 'Certificate Name',
				name: 'certName',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['obtain'] } },
				placeholder: 'example.com',
				description: 'Name for the certificate (defaults to first domain if empty)',
			},
			{
				displayName: 'Key Type',
				name: 'keyType',
				type: 'options',
				options: [
					{ name: 'ECDSA (Recommended)', value: 'ecdsa' },
					{ name: 'RSA', value: 'rsa' },
				],
				default: 'ecdsa',
				displayOptions: { show: { operation: ['obtain'] } },
				description: 'Type of private key to generate',
			},
			{
				displayName: 'Server',
				name: 'server',
				type: 'options',
				options: [
					{
						name: 'Production',
						value: 'production',
						description: 'Let\'s Encrypt production server (rate-limited)',
					},
					{
						name: 'Staging',
						value: 'staging',
						description: 'Let\'s Encrypt staging server (for testing)',
					},
				],
				default: 'production',
				displayOptions: { show: { operation: ['obtain'] } },
				description: 'Let\'s Encrypt ACME server to use',
			},
			{
				displayName: 'Force Renewal',
				name: 'forceRenewal',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['obtain', 'renew'] } },
				description: 'Whether to force renewal even if the certificate is not yet due',
			},
			{
				displayName: 'Propagation Seconds',
				name: 'propagationSeconds',
				type: 'number',
				default: 10,
				displayOptions: { show: { operation: ['obtain'] } },
				description: 'Seconds to wait for DNS propagation before validation',
			},
			{
				displayName: 'Additional Arguments',
				name: 'additionalArguments',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['obtain'] } },
				placeholder: '--preferred-challenges dns-01',
				description: 'Additional raw arguments to pass to certbot (trusted input only)',
			},

			// Renew parameters
			{
				displayName: 'Certificate Name',
				name: 'certNameRenew',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['renew'] } },
				placeholder: 'example.com',
				description: 'Name of the certificate to renew',
			},
			{
				displayName: 'Dry Run',
				name: 'dryRun',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['renew'] } },
				description: 'Whether to simulate the renewal without actually renewing',
			},

			// Revoke parameters
			{
				displayName: 'Revoke By',
				name: 'revokeBy',
				type: 'options',
				options: [
					{ name: 'Certificate Name', value: 'name' },
					{ name: 'Certificate Path', value: 'path' },
				],
				default: 'name',
				displayOptions: { show: { operation: ['revoke'] } },
				description: 'Whether to identify the certificate by name or file path',
			},
			{
				displayName: 'Certificate Name',
				name: 'certNameRevoke',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['revoke'], revokeBy: ['name'] } },
				placeholder: 'example.com',
				description: 'Name of the certificate to revoke',
			},
			{
				displayName: 'Certificate Path',
				name: 'certPath',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['revoke'], revokeBy: ['path'] } },
				placeholder: '/etc/letsencrypt/live/example.com/cert.pem',
				description: 'Full path to the certificate file to revoke',
			},
			{
				displayName: 'Reason',
				name: 'revokeReason',
				type: 'options',
				options: [
					{ name: 'Unspecified', value: 'unspecified' },
					{ name: 'Key Compromise', value: 'keycompromise' },
					{ name: 'Affiliation Changed', value: 'affiliationchanged' },
					{ name: 'Superseded', value: 'superseded' },
					{ name: 'Cessation of Operation', value: 'cessationofoperation' },
				],
				default: 'unspecified',
				displayOptions: { show: { operation: ['revoke'] } },
				description: 'Reason for revoking the certificate',
			},
			{
				displayName: 'Delete After Revoke',
				name: 'deleteAfterRevoke',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['revoke'] } },
				description: 'Whether to delete the certificate files after revoking',
			},

			// Delete parameters
			{
				displayName: 'Certificate Name',
				name: 'certNameDelete',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['delete'] } },
				placeholder: 'example.com',
				description: 'Name of the certificate to delete',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const useSudo = this.getNodeParameter('useSudo', i) as boolean;
				const prefix = useSudo ? 'sudo ' : '';

				switch (operation) {
					case 'obtain': {
						const result = await executeObtain(this, i, prefix);
						returnData.push({ json: result });
						break;
					}
					case 'renew': {
						const result = await executeRenew(this, i, prefix);
						returnData.push({ json: result });
						break;
					}
					case 'revoke': {
						const result = await executeRevoke(this, i, prefix);
						returnData.push({ json: result });
						break;
					}
					case 'delete': {
						const result = await executeDelete(this, i, prefix);
						returnData.push({ json: result });
						break;
					}
					case 'list': {
						const listItems = await executeList(prefix);
						for (const item of listItems) {
							returnData.push({ json: item });
						}
						break;
					}
					default:
						throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error instanceof Error ? error.message : String(error),
						},
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
