// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MandateVault
/// @notice Escrows native MON and releases it only under one fixed, signed transfer policy.
contract MandateVault is EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    uint64 public constant MAX_LIFETIME = 90 days;
    bytes32 private constant TRANSFER_INTENT_TYPEHASH =
        keccak256("TransferIntent(bytes32 mandateId,address recipient,uint256 amount,uint256 nonce,uint64 deadline)");

    struct Mandate {
        address principal;
        address agentSigner;
        address approvedRecipient;
        uint256 perCallLimit;
        uint256 totalLimit;
        uint256 spent;
        uint64 expiresAt;
        uint256 nextNonce;
        bool active;
        bytes32 policyHash;
        uint256 deposited;
    }

    struct TransferIntent {
        bytes32 mandateId;
        address recipient;
        uint256 amount;
        uint256 nonce;
        uint64 deadline;
    }

    mapping(bytes32 mandateId => Mandate mandate) private mandates;
    mapping(address principal => mapping(bytes32 salt => bool used)) public usedSalts;

    error ZeroAddress();
    error InvalidLimits();
    error InvalidExpiry();
    error DuplicateSalt();
    error UnknownMandate();
    error Unauthorized();
    error MandateInactive();
    error MandateStillActive();
    error MandateExpired();
    error DepositExceedsBudget();
    error InvalidIntent();
    error InvalidSigner();
    error PerCallLimitExceeded();
    error TotalLimitExceeded();
    error InsufficientDeposit();
    error TransferFailed();

    event MandateCreated(
        bytes32 indexed mandateId, address indexed principal, address indexed agentSigner, address recipient
    );
    event MandateFunded(bytes32 indexed mandateId, uint256 amount);
    event MandateRevoked(bytes32 indexed mandateId);
    event TransferExecuted(
        bytes32 indexed mandateId, uint256 indexed nonce, address indexed recipient, uint256 amount, address signer
    );
    event FundsWithdrawn(bytes32 indexed mandateId, address indexed principal, uint256 amount);

    constructor() EIP712("MandateVault", "1") {}

    function createMandate(
        address agentSigner,
        address approvedRecipient,
        uint256 perCallLimit,
        uint256 totalLimit,
        uint64 expiresAt,
        bytes32 policyHash,
        bytes32 salt
    ) external returns (bytes32 mandateId) {
        if (agentSigner == address(0) || approvedRecipient == address(0)) revert ZeroAddress();
        if (perCallLimit == 0 || totalLimit < perCallLimit) revert InvalidLimits();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_LIFETIME) revert InvalidExpiry();
        if (usedSalts[msg.sender][salt]) revert DuplicateSalt();

        mandateId = keccak256(abi.encode(block.chainid, address(this), msg.sender, salt));
        usedSalts[msg.sender][salt] = true;
        mandates[mandateId] = Mandate({
            principal: msg.sender,
            agentSigner: agentSigner,
            approvedRecipient: approvedRecipient,
            perCallLimit: perCallLimit,
            totalLimit: totalLimit,
            spent: 0,
            expiresAt: expiresAt,
            nextNonce: 0,
            active: true,
            policyHash: policyHash,
            deposited: 0
        });
        emit MandateCreated(mandateId, msg.sender, agentSigner, approvedRecipient);
    }

    function fundMandate(bytes32 mandateId) external payable {
        Mandate storage mandate = mandates[mandateId];
        if (mandate.principal == address(0)) revert UnknownMandate();
        if (msg.sender != mandate.principal) revert Unauthorized();
        if (!mandate.active) revert MandateInactive();
        if (block.timestamp >= mandate.expiresAt) revert MandateExpired();
        if (msg.value == 0 || mandate.spent + mandate.deposited + msg.value > mandate.totalLimit) {
            revert DepositExceedsBudget();
        }
        mandate.deposited += msg.value;
        emit MandateFunded(mandateId, msg.value);
    }

    function revokeMandate(bytes32 mandateId) external {
        Mandate storage mandate = mandates[mandateId];
        if (mandate.principal == address(0)) revert UnknownMandate();
        if (msg.sender != mandate.principal) revert Unauthorized();
        if (!mandate.active) revert MandateInactive();
        mandate.active = false;
        emit MandateRevoked(mandateId);
    }

    function executeTransfer(TransferIntent calldata intent, bytes calldata signature) external nonReentrant {
        Mandate storage mandate = mandates[intent.mandateId];
        if (mandate.principal == address(0)) revert UnknownMandate();
        if (!mandate.active) revert MandateInactive();
        if (block.timestamp >= mandate.expiresAt) revert MandateExpired();
        if (
            intent.recipient != mandate.approvedRecipient || intent.amount == 0 || intent.nonce != mandate.nextNonce
                || intent.deadline < block.timestamp || intent.deadline > mandate.expiresAt
        ) revert InvalidIntent();

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_INTENT_TYPEHASH,
                intent.mandateId,
                intent.recipient,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );
        address signer = _hashTypedDataV4(structHash).recover(signature);
        if (signer != mandate.agentSigner) revert InvalidSigner();
        if (intent.amount > mandate.perCallLimit) revert PerCallLimitExceeded();
        if (mandate.spent + intent.amount > mandate.totalLimit) revert TotalLimitExceeded();
        if (intent.amount > mandate.deposited) revert InsufficientDeposit();

        mandate.spent += intent.amount;
        mandate.deposited -= intent.amount;
        mandate.nextNonce += 1;
        (bool success,) = mandate.approvedRecipient.call{value: intent.amount}("");
        if (!success) revert TransferFailed();
        emit TransferExecuted(intent.mandateId, intent.nonce, mandate.approvedRecipient, intent.amount, signer);
    }

    function withdrawAfterRevoke(bytes32 mandateId) external nonReentrant {
        Mandate storage mandate = mandates[mandateId];
        if (mandate.principal == address(0)) revert UnknownMandate();
        if (msg.sender != mandate.principal) revert Unauthorized();
        if (mandate.active) revert MandateStillActive();
        uint256 amount = mandate.deposited;
        mandate.deposited = 0;
        (bool success,) = mandate.principal.call{value: amount}("");
        if (!success) revert TransferFailed();
        emit FundsWithdrawn(mandateId, mandate.principal, amount);
    }

    function getMandate(bytes32 mandateId) external view returns (Mandate memory) {
        Mandate memory mandate = mandates[mandateId];
        if (mandate.principal == address(0)) revert UnknownMandate();
        return mandate;
    }
}
